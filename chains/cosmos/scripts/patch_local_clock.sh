#!/bin/sh
set -eu

cd /src/ibc-go
test "$(go list -m -f '{{.Version}}' github.com/cometbft/cometbft)" = v0.38.11
clock_dir="$(go list -m -f '{{.Dir}}' github.com/cometbft/cometbft)"
# A local replacement keeps the original module cache and checksum checks intact.
cp -a "$clock_dir" /src/cometbft-local-clock
chmod -R u+w /src/cometbft-local-clock
go mod edit -replace github.com/cometbft/cometbft=/src/cometbft-local-clock
clock_file="/src/cometbft-local-clock/types/time/time.go"
test "$(grep -c 'return Canonical(time.Now())' "$clock_file")" = 1
chmod u+w "$clock_file"
sed -i 's/return Canonical(time.Now())/return Canonical(time.Now().Add(localClockOffset))/' "$clock_file"
sed -i 's/"sort"/"os"\n\t"sort"/' "$clock_file"
cat >> "$clock_file" <<'GO'

// This file is present only in the isolated DevKit test fixture image.
var localClockOffset = func() time.Duration {
    text := os.Getenv("DEVKIT_CLOCK_OFFSET")
    if text == "" {
        panic("isolated fixture requires DEVKIT_CLOCK_OFFSET")
    }
    offset, err := time.ParseDuration(text)
    if err != nil {
        panic(err)
    }
    return offset
}()
GO
cat > /tmp/check-local-clock.go <<'GO'
package main
import (
    "fmt"
    "time"
    cmttime "github.com/cometbft/cometbft/types/time"
)
func main() {
    actual := cmttime.Now().Sub(time.Now())
    if actual < -time.Hour-time.Second || actual > -time.Hour+time.Second {
        panic(fmt.Sprintf("wrong clock offset: %s", actual))
    }
    fmt.Println("CometBFT local fixture clock: one-hour offset verified")
}
GO
DEVKIT_CLOCK_OFFSET=-3600s go run /tmp/check-local-clock.go
gofmt -w "$clock_file"
