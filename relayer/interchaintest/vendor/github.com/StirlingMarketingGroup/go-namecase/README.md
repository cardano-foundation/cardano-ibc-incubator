# NameCase

Forenames and surnames are often stored either entirely in UPPERCASE or lowercase. This package allows you to convert names into the correct case where possible. Although forenames and surnames are typically stored separately if they do appear in a single string, whitespace-separated, NameCase deals correctly with them.

Currently NameCase correctly name cases names which include any of the following:

```
Mc, Mac, al, el, ap, bat, ben, bin, binti, binte, da, de, das, dos, delle, della, di, du, del, der, den, ten, ter, la, le, lo, van and von.
```

It correctly deals with names which contain apostrophes and hyphens too.

## Install

Just like any other go library

```bash
go get github.com/StirlingMarketingGroup/go-namecase
```

## Usage

```go
import "github.com/StirlingMarketingGroup/go-namecase"

func main() {
    f := namecase.New()
    f.NameCase("KEITH")                            // => Keith
    f.NameCase("LEIGH-WILLIAMS")                   // => Leigh-Williams
    f.NameCase("MCCARTHY")                         // => McCarthy
    f.NameCase("O'CALLAGHAN")                      // => O'Callaghan
    f.NameCase("ST. JOHN")                         // => St. John
    f.NameCase("VON STREIT")                       // => von Streit
    f.NameCase("AP LLWYD DAFYDD")                  // => ap Llwyd Dafydd
    f.NameCase("HENRY VIII")                       // => Henry VIII
    f.NameCase("VAN DYKE")                         // => van Dyke
    f.NameCase("PRINCE PHILIP, DUKE OF EDINBURGH") // => Prince Philip, Duke of Edinburgh

    // Passing options
    f.SetOptions(namecase.Options{
        Lazy:        true,
        Irish:       true,
        Spanish:     false,
        Roman:       true,
        Hebrew:      true,
        PostNominal: true,
    })

    // Or
    f.SetSpanish(true)

    // Or even
    opts := namecase.DefaultOptions()
    opts.Lazy = false
    f = namecase.NewOptions(opts)
}
```

## Options

* `lazy` – Default: `true`. Do not do anything if string is already mixed case and lazy option is `true`.
* `irish` – Default: `true`. Correct "Mac" exceptions.
* `spanish` – Default: `false`. Correct `el, la` and spanish conjunctions.
* `roman` – Default: `true`. Correct roman numbers.
* `hebrew` – Default: `true`. Correct `ben, bat`.
* `postnominal` – Default: `true`. Correct post-nominal e.g. `PhD`.

## Exclude Post-Nominals

```go
import "github.com/StirlingMarketingGroup/go-namecase"

func main() {
    f := namecase.New()
    f.ExcludePostNominals("MOst")

    f.NameCase("ČERNÝ MOST") // Černý Most
}
```

## Testing & Demo

```bash
go test -run . github.com/StirlingMarketingGroup/go-namecase
```

## Contributing

Please see [CONTRIBUTING](CONTRIBUTING.md) and [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) for details.

## Security

If you discover any security-related issues, please email <bleishman@stirlingmarketinggroup.com> instead of using the issue tracker.

## Acknowledgements

This is a Golang port of the awesome library over at https://github.com/tamtamchik/namecase, which is a port of the [Perl library](https://metacpan.org/release/BARBIE/Lingua-EN-NameCase-1.19) and owes most of its functionality to the Perl version by Mark Summerfield.
I also used some solutions from [Ruby version](https://github.com/tenderlove/namecase) by Aaron Patterson.
Any bugs in the Golang port are my fault.

## Credits

Original PERL `Lingua::EN::NameCase` Version:

- Copyright &copy; Mark Summerfield 1998-2014. All Rights Reserved.
- Copyright &copy; Barbie 2014-2019. All Rights Reserved.
