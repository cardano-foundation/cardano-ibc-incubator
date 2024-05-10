export class CurrentEpochSettingsResponseDTO {
  epoch: number;
  protocol: {
    k: number;
    m: number;
    phi_f: number;
  };
  next_protocol: {
    k: number;
    m: number;
    phi_f: number;
  };
}
