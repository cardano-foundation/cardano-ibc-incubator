validator voucher_metadata {
  else(_) {
    fail @"Voucher metadata outputs are immutable"
  }
}
