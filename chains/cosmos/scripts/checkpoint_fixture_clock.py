"""Install a controlled clock only in the disposable checkpoint test binary."""
from pathlib import Path
import re
import sys
clock = Path(sys.argv[1])
for candidate in clock.parent.glob('*.go'):
    if 'return Canonical(time.Now())' in candidate.read_text():
        clock = candidate
        break
source = clock.read_text()
assert source.count('return Canonical(time.Now())') == 1
source = source.replace('import (', 'import (\n"os"\n"strconv"\n"strings"\n"sync"\n"sync/atomic"')
source = source.replace('return Canonical(time.Now())', '''path := os.Getenv("CHECKPOINT_FIXTURE_CLOCK")
if path == "" { return Canonical(time.Now()) }
var offset int64
if os.Getenv("CHECKPOINT_FIXTURE_AUTO_STEP") == "1" {
    checkpointFixtureInit.Do(func() { checkpointFixtureOffset.Store(readCheckpointFixtureOffset(path)) })
    offset = checkpointFixtureOffset.Load()
} else { offset = readCheckpointFixtureOffset(path) }
return Canonical(time.Now().Add(time.Duration(offset)))''')
source += '''
var checkpointFixtureInit sync.Once
var checkpointFixtureOffset atomic.Int64
var checkpointFixtureHeight atomic.Int64
func readCheckpointFixtureOffset(path string) int64 {
    raw,err:=os.ReadFile(path)
    if err!=nil { panic(err) }
    offset,err:=strconv.ParseInt(strings.TrimSpace(string(raw)),10,64)
    if err!=nil { panic(err) }
    return offset
}
// Only a new proposed height advances the accelerated clock. Ordinary elapsed
// time still advances while the driver pauses it for a transaction or restart.
func AdvanceCheckpointFixtureClock(height int64) {
    path:=os.Getenv("CHECKPOINT_FIXTURE_CLOCK")
    if path=="" || os.Getenv("CHECKPOINT_FIXTURE_AUTO_STEP")!="1" { return }
    checkpointFixtureInit.Do(func() { checkpointFixtureOffset.Store(readCheckpointFixtureOffset(path)) })
    previous:=checkpointFixtureHeight.Load()
    if height<=previous || !checkpointFixtureHeight.CompareAndSwap(previous,height) { return }
    if _,err:=os.Stat(path+".pause");err==nil { return }
    offset:=checkpointFixtureOffset.Add(int64(8*time.Second))
    if height%128==0 {
        if err:=os.WriteFile(path+".tmp",[]byte(strconv.FormatInt(offset,10)),0600);err!=nil { panic(err) }
        if err:=os.Rename(path+".tmp",path);err!=nil { panic(err) }
    }
}
'''
clock.write_text(source)
states = [candidate for candidate in clock.parents[2].rglob('state.go') if re.search(r'func \(\w+ \*State\) createProposalBlock\(', candidate.read_text())]
assert len(states) == 1, states
state = states[0]
text = state.read_text()
alias = re.search(r'(\w+) "github.com/cometbft/cometbft/types/time"', text)
assert alias, 'CometBFT time import changed'
method = re.search(r'func \((\w+) \*State\) createProposalBlock\(', text)
assert method, 'CometBFT proposal method changed'
brace = text.index('{', method.end())
text = text[:brace+1] + f'\n{alias[1]}.AdvanceCheckpointFixtureClock({method[1]}.Height)\n' + text[brace+1:]
state.write_text(text)
