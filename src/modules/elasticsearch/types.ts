import { Client } from '@elastic/elasticsearch'
import { ParcelFragment } from '../asset/types'

export interface IElasticsearchComponent {
    client: Client,
    bulkInsertParcels: (_landTokens: ParcelFragment[]) => Promise<void>,
}

export class SolanaTownPropertyElasticsearch {
    id: string
    owner: string
    network: string
    chain_id: number
    contract_address: string
    name: string
    description: string
    image: string
    external_url: string
    attributes: object
}

export type ParcelURIFormat = {
    name: string
    description: string
    seller_fee_basis_points: number
    image: string
    attributes: Attribute[]
    external_url: string
}

export type Attribute = {
    trait_type: string
    value: number | string
}