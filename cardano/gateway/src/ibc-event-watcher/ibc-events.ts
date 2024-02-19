import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class ConsensusStateEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  dataField: string;
}
