import { IBaseComponent, IConfigComponent } from "@well-known-components/interfaces";
import { Attribute, IElasticsearchComponent, SolanaTownPropertyElasticsearch } from "./types";
import { Client } from '@elastic/elasticsearch'
import { ParcelFragment } from "../asset/types";
import { ChainId, SolanaNetwork } from "nftopia-shared/dist/shared/network"
import { SolanaTownAssetAttributes, SolanaTownAssetDto, SolanaTownAssetType } from "nftopia-shared/dist/shared/asset"
import { MetaversePlatform } from "nftopia-shared/dist/shared/platform/types";

export async function createElasticsearchComponent(components: {
    config: IConfigComponent,
}): Promise<IElasticsearchComponent & IBaseComponent> {
    const { config } = components

    let client: Client;
    // try to use cloud first
    try {
        // get config
        const cloudId = await config.requireString("ES_CLOUD_ID")
        const apiKey = await config.requireString("ES_API_KEY")
        client = new Client({
            cloud: { id: cloudId },
            auth: { apiKey: apiKey },
        })
        console.log('Elastic search connected to cloud')
    } catch (ex) {
        console.error('Elasticsearch connection error: failed to connect cloud service');
    }

    // try to use self hosted node
    try {
        // get config
        const esNodeHost = await config.requireString("ES_NODE_HOST")
        const esNodePort = await config.requireString("ES_NODE_PORT")
        const esNodeUrl = `http://${esNodeHost}:${esNodePort}`
        client = new Client({
            node: esNodeUrl
        })
        console.log('Elastic search connected to self hosted node')
    } catch (ex) {
        console.error('Elasticsearch connection error: failed to connect to self hosted node');
    }

    if (!client) {
        throw new Error("Elasticsearch connection error: neither elastic cloud or docker are not connected.")
    }

    // get config of blockchain network, chain id and contract addresses
    const bcChainId = (await config.requireString('BLOCKCHAIN_CHAIN_ID')) as ChainId
    const bcNetwork = (await config.requireString('BLOCKCHAIN_NETWORK')) as SolanaNetwork

    // check and init mappings
    const PROPERTY_INDEX_NAME = `${MetaversePlatform.SolanaTown}-${bcChainId}-${bcNetwork}`
    const isPropertyIndexExisted = await client.indices.exists({ index: PROPERTY_INDEX_NAME })
    if (!isPropertyIndexExisted) {
        console.log('property index unexisted, create new');
        const createResp = await client.indices.create({
            index: PROPERTY_INDEX_NAME,
            mappings: {
                properties: {
                    // base asset dto
                    "platform": {
                        "type": "keyword"
                    },
                    "network": {
                        "type": "keyword",
                        "index": false,
                    },
                    "chain_id": {
                        "type": "keyword",
                        "index": false,
                    },
                    "contract_address": {
                        "type": "text",
                        "index": false
                    },
                    "id": {
                        "type": "keyword",
                    },
                    "name": {
                        "type": "text",
                        "analyzer": "standard"
                    },
                    "description": {
                        "type": "text",
                        "analyzer": "standard"
                    },
                    "owner": {
                        "type": "keyword",
                    },
                    "image": {
                        "type": "text",
                        "index": false,
                    },
                    "external_url": {
                        "type": "text",
                        "index": false,
                    },
                    // attributes
                    "attributes.x": {
                        "type": "integer",
                    },
                    "attributes.y": {
                        "type": "integer",
                    },
                    "attributes.type": {
                        "type": "keyword",
                    }
                }
            }
        })

        console.log(`${createResp.index} creation response: ${createResp.acknowledged}`)
    }

    const bulkInsertParcels = async (_landTokens: ParcelFragment[]) => {
        if (_landTokens.length === 0) return

        let dataset: SolanaTownAssetDto[] = []
        for (const _landToken of _landTokens) {
            let name = ""
            let description = ""
            let image = ""
            let external_url = ""
            let attributes = {}

            if (_landToken.tokenURIContent && Object.keys(_landToken.tokenURIContent).length > 0) {
                name = _landToken.tokenURIContent.name
                description = _landToken.tokenURIContent.description
                image = _landToken.tokenURIContent.image
                external_url = _landToken.tokenURIContent.external_url

                attributes = parseAttributes(_landToken.tokenURIContent.attributes)
            }

            let landToken: SolanaTownAssetDto = {
                platform: MetaversePlatform.SolanaTown,
                network: bcNetwork,
                chain_id: bcChainId,
                contract_address: 'emptyyyy', // TODO: what should I place?
                id: _landToken.id,
                name: name,
                description: description,
                owner: _landToken.owner?.id || "",
                image: image,
                external_url: external_url,
                attributes: attributes as SolanaTownAssetAttributes
            }

            dataset.push(landToken)
        }

        const operations = dataset.flatMap(doc => [{ index: { _index: PROPERTY_INDEX_NAME, _id: doc.id } }, doc])
        const bulkResponse = await client.bulk({ refresh: true, operations })

        if (bulkResponse.errors) {
            console.log(bulkResponse.items[0].index.error)
            console.error(bulkResponse.errors);
        }
    }

    return {
        client,
        bulkInsertParcels,
    }
}

function parseAttributes(_attributes: Attribute[]): object {
    let attributesElasticsearch = {}

    for (const attr of _attributes) {
        switch (attr.trait_type) {
            case "X":
                attributesElasticsearch["x"] = Number(attr.value)
                break;
            case "Y":
                attributesElasticsearch["y"] = Number(attr.value)
                break;
            case "Type":
                attributesElasticsearch["type"] = (attr.value as string).toLowerCase()
                break;
            default:
        }
    }

    return attributesElasticsearch
}