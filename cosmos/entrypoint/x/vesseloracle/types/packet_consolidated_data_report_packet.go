package types

// ValidateBasic is used for validating the packet
func (p ConsolidatedDataReportPacketPacketData) ValidateBasic() error {

	// TODO: Validate the packet data

	return nil
}

// GetBytes is a helper for serialising
func (p ConsolidatedDataReportPacketPacketData) GetBytes() ([]byte, error) {
	var modulePacket VesseloraclePacketData

	modulePacket.Packet = &VesseloraclePacketData_ConsolidatedDataReportPacketPacket{&p}

	return modulePacket.Marshal()
}
