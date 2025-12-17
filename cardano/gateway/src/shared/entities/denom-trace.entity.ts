import { Entity, Column, PrimaryColumn } from 'typeorm';

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

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  first_seen: Date;

  @Column({ nullable: true })
  tx_hash: string;
}
