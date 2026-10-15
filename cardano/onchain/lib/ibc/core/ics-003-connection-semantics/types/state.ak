// Frozen public commitment primitive. Keep its constructors and order unchanged.
// See docs/cardano-commitment-codec.md.
pub type State {
  Uninitialized
  Init
  TryOpen
  Open
}
