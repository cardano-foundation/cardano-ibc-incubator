/// Status represents the status of a client
pub type Status {

  /// Active is a status type of a client. An active client is allowed to be used.
  Active

  /// Frozen is a status type of a client. A frozen client is not allowed to be used.
  Frozen

  /// Expired is a status type of a client. An expired client is not allowed to be used.
  Expired

  /// Unknown indicates there was an error in determining the status of a client.
  Unknown

  /// Unauthorized indicates that the client type is not registered as an allowed client type.
  Unauthorized
}
