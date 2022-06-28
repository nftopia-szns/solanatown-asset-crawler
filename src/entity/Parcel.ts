import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm"

@Entity()
export class Parcel {
    @PrimaryColumn()
    id: string

    @Column({ nullable: true, default: null })
    owner?: string

    @Column('jsonb', { nullable: true, default: null })
    tokenURIContent?: string

    @CreateDateColumn()
    createdAt: Date

    @UpdateDateColumn()
    updatedAt: Date

    @DeleteDateColumn({ nullable: true, default: null })
    deletedAt?: Date
}
