import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

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
