export class RegisterdSignersResponseDTO {
  registered_at: number;
  signing_at: number;
  registrations: RegistrationDTO[];
}

export class RegistrationDTO {
  party_id: string;
  stake: number;
}
