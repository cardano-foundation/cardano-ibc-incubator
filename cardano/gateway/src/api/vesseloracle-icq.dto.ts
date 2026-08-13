import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { AsyncIcqBaseRequestDto } from './async-icq.dto';

// These DTOs remain unregistered while the VesselOracle integration is dormant.

export class VesseloracleConsolidatedDataReportIcqRequestDto extends AsyncIcqBaseRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  imo: string;

  @ApiProperty({
    description: 'Consolidated report timestamp as an unsigned integer string',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, {
    message: 'ts must be a non-negative integer string',
  })
  ts: string;
}

export class VesseloracleLatestConsolidatedDataReportIcqRequestDto extends AsyncIcqBaseRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  imo: string;
}
