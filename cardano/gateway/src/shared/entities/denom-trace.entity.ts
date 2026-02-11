import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('denom_traces')
export class DenomTrace {
  @PrimaryColumn()
  hash: string;

  @Column()
  path: string;

  @Column()
  base_denom: string;

  @Column()
  voucher_policy_id: string;

  @Index('idx_denom_traces_ibc_denom_hash')
  @Column({ nullable: true })
  ibc_denom_hash: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  first_seen: Date;

  @Column({ nullable: true })
  tx_hash: string;
}
