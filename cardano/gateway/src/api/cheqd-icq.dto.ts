import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { AsyncIcqBaseRequestDto } from './async-icq.dto';

export class CheqdDidDocIcqRequestDto extends AsyncIcqBaseRequestDto {
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

export class CheqdResourceIcqRequestDto extends AsyncIcqBaseRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  collection_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class CheqdLatestResourceVersionIcqRequestDto extends AsyncIcqBaseRequestDto {
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
