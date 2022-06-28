import { IBaseComponent, IConfigComponent, IStatusCheckCapableComponent } from '@well-known-components/interfaces'
import {
  IAssetComponent,
  ParcelFragment,
  LandTokenResult as ParcelResult,
} from './types'
import {
  graphql, sleep, _fetchTokenURIContent,
} from './utils'
import { IDatabaseComponent } from '../database/types'
import { LastSync } from '../../entity/LastSync'
import { IElasticsearchComponent, ParcelURIFormat } from '../elasticsearch/types'
import hashList from './data/hash_list.json';
import Moralis from "moralis/node"

export async function createAssetComponent(components: {
  config: IConfigComponent,
  database: IDatabaseComponent,
  elasticsearch: IElasticsearchComponent,
}): Promise<IAssetComponent & IBaseComponent & IStatusCheckCapableComponent> {
  const { config, database, elasticsearch } = components

  // config

  const url = await config.requireString('API_URL')
  const batchSize = await config.requireNumber('API_BATCH_SIZE')
  const concurrency = await config.requireNumber('API_CONCURRENCY')
  const refreshInterval = await config.requireNumber('REFRESH_INTERVAL') * 1000

  // init moralis
  const serverUrl = "https://yd9zqpf3zlup.usemoralis.com:2053/server"
  const masterKey = "LqpYF3r7GE38LinFYJyYJAGVUQ7OtI4pcXeZoi2u";
  await Moralis.start({ serverUrl, masterKey });
  const solanaAPI = Moralis.SolanaAPI

  // data
  let ready = false
  let landTokenLastUpdatedAt = 0

  // events
  const lifeCycle: IBaseComponent = {
    async start() {
      await parcelStart()
    }
  }

  const statusChecks: IStatusCheckCapableComponent = {
    async startupProbe() {
      return isReady()
    },
    async readynessProbe() {
      return isReady()
    },
  }

  // methods

  async function parcelStart(): Promise<any> {
    // import all parcels (only id field) in hashlist to db
    const _parcels = hashList.map<ParcelFragment>((v) => ({ id: v }))
    database.unsafeInsertBatchParcels(_parcels)

    fetchTokenURIContent()
  }

  // async function poll() {
  //   try {
  //     console.log("Polling land token changes after", landTokenLastUpdatedAt)
  //     const result = await fetchUpdatedLandTokens(landTokenLastUpdatedAt)
  //     console.log("Received ", result.landTokens.length, " land token(s) to be updated")
  //     if (result.landTokens && result.landTokens.length > 0) {
  //       // update in db
  //       database.updateLastUpdatedAt("land_token", landTokenLastUpdatedAt)
  //       database.insertOrUpdateBatchParcels(result.landTokens)
  //       elasticsearch.bulkInsertParcels(result.landTokens)
  //     }
  //   } catch (e) {
  //     console.error(e)
  //   }

  //   await sleep(refreshInterval)
  //   poll()
  // }

  async function fetchTokenURIContent() {
    console.log('Started new token URI fetch round');
    const landTokens = await database.fetchLandTokensWithNoTokenURIContent()

    if (landTokens.length > 0) {
      for (const landToken of landTokens) {
        try {
          const options = {
            network: "mainnet" as ("mainnet" | "devnet"),
            address: landToken.id
          }
          const nftMetadata = await solanaAPI.nft.getNFTMetadata(options)

          const content = await _fetchTokenURIContent<ParcelURIFormat>(nftMetadata.metaplex.metadataUri)
          console.log('Fetched ', landToken.id);
          
          await database.updateTokenURIContent(landToken.id, JSON.stringify(content))

          // in case if this is valid content -> update in elasticsearch
          if (Object.keys(content).length > 0) {
            // update in elasticsearch
            const landTokenFragment = {
              id: landToken.id,
              // owner: {
              //   id: landToken.owner
              // },
              tokenURIContent: content,
            }
            await elasticsearch.bulkInsertParcels([landTokenFragment])
          }
        } catch (error) {
          console.error(`Token ${landToken.id} URI content fetch failed: ${error}`)
        }
      }

      fetchTokenURIContent()
    }
  }

  // async function fetchAllParcels() {
  //   let parcels: ParcelFragment[] = []

  //   // auxiliars
  //   let batches: Promise<ParcelFragment[]>[] = []
  //   let complete = false
  //   let lastTokenId = ''

  //   while (!complete) {
  //     // fetch batch
  //     const batch = fetchBatchParcels(lastTokenId, batches.length).then((batch) => {
  //       console.log("Fetched batch with", batch.length, " parcels");

  //       // insert batch to database, without waiting for it
  //       database.unsafeInsertBatchParcels(batch)

  //       // insert batch to elastic
  //       // elasticsearch.bulkInsertParcels(batch)

  //       // update memory storage parcels
  //       parcels = parcels.concat(batch)
  //       return batch
  //     })

  //     // when max concurrency is reached...
  //     batches.push(batch)
  //     if (batches.length === Math.max(concurrency, 1)) {
  //       // ...wait for all the batches to finish
  //       const results = await Promise.all(batches)

  //       const nonEmptyResults = results.filter((result) => result.length > 0)
  //       // if results are non-empty
  //       if (nonEmptyResults.length > 0) {
  //         // find last token id
  //         lastTokenId = nonEmptyResults
  //           .pop()! // take last result
  //           .pop()!.id! // take the last element and its token id
  //       }

  //       // prepare next iteration
  //       complete = results
  //         .some((result) => result.length === 0)
  //       batches = []
  //     }
  //   }

  //   const result: ParcelResult = {
  //     landTokens: parcels,
  //   }

  //   return result
  // }

  // async function fetchBatchParcels(lastTokenId = '', page = 0) {
  //   const { parcels } = await graphql<{ parcels: ParcelFragment[] }>(
  //     url,
  //     `{
  //       parcels(
  //         first: ${batchSize},
  //         skip: ${batchSize * page},
  //         orderBy: id,
  //         orderDirection: asc,
  //         where: {
  //           ${lastTokenId ? `id_gt: "${lastTokenId}",` : ''}
  //         }
  //       ) ${parcelFields}
  //     }`
  //   )

  //   return parcels
  // }

  // async function fetchUpdatedLandTokens(updatedAfter: number) {
  //   try {
  //     const { landTokens } = await graphql<{
  //       landTokens: ParcelFragment[]
  //     }>(
  //       url,
  //       `{
  //       landTokens(
  //         first: ${batchSize},
  //         orderBy: timestamp,
  //         orderDirection: asc,
  //         where: {
  //           timestamp_gt: "${updatedAfter}",
  //         }
  //       ) ${parcelFields}
  //     }`
  //     )

  //     if (!landTokens.length) {
  //       return {
  //         landTokens,
  //         updatedAt: updatedAfter
  //       }
  //     }

  //     const result: ParcelResult = {
  //       landTokens,
  //     }

  //     return result
  //   } catch (e) {
  //     throw new Error(`Failed to fetch update data: ${e.message}`)
  //   }
  // }

  function isReady() {
    return ready
  }

  return {
    ...lifeCycle,
    ...statusChecks,
    isReady,
  }
}
