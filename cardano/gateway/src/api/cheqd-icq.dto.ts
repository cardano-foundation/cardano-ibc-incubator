import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

class IcqHeightDto {
  @ApiPropertyOptional()
  @IsOptional()
  revision_number?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  revision_height?: string | number;
}

export class CheqdIcqBaseRequestDto {
  @ApiProperty()
  @IsNotEmpty()
  @Matches(/^channel/, {
    message: 'source_channel should start with channel',
  })
  source_channel: string;

  @ApiProperty()
  @IsNotEmpty()
  signer: string;

  @ApiPropertyOptional({
    type: IcqHeightDto,
  })
  @IsOptional()
  timeout_height?: IcqHeightDto;

  @ApiPropertyOptional()
  @IsOptional()
  timeout_timestamp?: string | number;
}

export class CheqdDidDocIcqRequestDto extends CheqdIcqBaseRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class CheqdDidDocVersionIcqRequestDto extends CheqdDidDocIcqRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  version: string;
}

export class CheqdResourceIcqRequestDto extends CheqdIcqBaseRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  collection_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class CheqdLatestResourceVersionIcqRequestDto extends CheqdIcqBaseRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  collection_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  resource_type: string;
}

export class CheqdIcqAcknowledgementDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9a-fA-F]+$/, {
    message: 'acknowledgement_hex must be hex encoded',
  })
  acknowledgement_hex: string;
}

export class CheqdIcqResultRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  query_path: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9a-fA-F]+$/, {
    message: 'packet_data_hex must be hex encoded',
  })
  packet_data_hex: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]+$/, {
    message: 'tx_hash must be hex encoded',
  })
  tx_hash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d+$/, {
    message: 'since_height must be a non-negative integer string',
  })
  since_height?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^channel/, {
    message: 'source_channel should start with channel',
  })
  source_channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d+$/, {
    message: 'packet_sequence must be a non-negative integer string',
  })
  packet_sequence?: string;
}
