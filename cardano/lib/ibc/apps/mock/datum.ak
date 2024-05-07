use ibc/core/ics_004/types/packet.{Packet}

pub type MockModuleDatum {
  received_packets: List<Packet>,
}
