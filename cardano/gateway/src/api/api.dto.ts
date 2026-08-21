import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsString, Matches, ValidateNested } from 'class-validator';

export class Coin {
  @ApiProperty()
  @IsNotEmpty()
  denom: string;
  @ApiProperty()
  @IsNotEmpty()
  amount: bigint;
}

class Height {
  @ApiProperty()
  revision_number: bigint;
  @ApiProperty()
  revision_height: bigint;
}
export class MsgtransferDto {
  @IsNotEmpty()
  @ApiProperty()
  source_port: string;

  @IsNotEmpty()
  @ApiProperty()
  @Matches(/^channel/, {
    message: 'source_channel should start with channel',
  })
  source_channel: string;

  @ApiProperty({
    type: Coin,
  })
  token: Coin;

  @ApiProperty()
  @IsNotEmpty()
  sender: string;

  @ApiProperty()
  @IsNotEmpty()
  receiver: string;

  @ApiPropertyOptional({
    type: Height,
  })
  timeout_height?: Height;

  @ApiProperty()
  @IsNotEmpty()
  timeout_timestamp: bigint;
  @ApiProperty()
  memo: string;
  @ApiProperty()
  @IsNotEmpty()
  signer: string;
}

export class EstimateLocalOsmosisSwapDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  from_chain_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token_in_denom: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token_in_amount: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  to_chain_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token_out_denom: string;
}

export class PlanTransferRouteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  from_chain_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  to_chain_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token_denom: string;
}

class PrunePacketHistoryHeightDto {
  @ApiProperty()
  @IsString()
  @Matches(/^\d+$/)
  revision_number: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d+$/)
  revision_height: string;
}

export class PrunePacketHistoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  signer: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  port_id: string;

  @ApiProperty()
  @IsString()
  @Matches(/^channel-\d+$/)
  channel_id: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d+$/)
  sequence: string;

  @ApiProperty({ description: 'Base64-encoded protobuf MerkleProof bytes' })
  @IsString()
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  proof_commitment_absence: string;

  @ApiProperty({ type: PrunePacketHistoryHeightDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PrunePacketHistoryHeightDto)
  proof_height: PrunePacketHistoryHeightDto;
}
