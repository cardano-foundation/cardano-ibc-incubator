package namecase

import (
	"regexp"
	"strings"
	"unicode"
)

// Formatter is a namecase formatter
type Formatter struct {
	options Options

	exceptions   []regexpPair
	replacements []regexpPair
	spanish      []regexpPair
	hebrew       []regexpPair
	conjunctions []regexpPair
	romanRegexp  *regexp.Regexp
	postNominals map[string]*regexp.Regexp

	lowerCaseWords []regexpPair
}

// Options is the namecase formatter options
type Options struct {
	Lazy        bool
	Irish       bool
	Spanish     bool
	Roman       bool
	Hebrew      bool
	PostNominal bool
}

type regexpPair struct {
	regexp *regexp.Regexp
	string
}

// DefaultOptions returns the default namecase options
func DefaultOptions() Options {
	return Options{
		Lazy:        true,
		Irish:       true,
		Spanish:     false,
		Roman:       true,
		Hebrew:      true,
		PostNominal: true,
	}
}

// New returns a new formatter with default options
func New() Formatter {
	return NewOptions(DefaultOptions())
}

// NewOptions returns a new formatter
func NewOptions(options Options) Formatter {
	f := Formatter{
		options: options,
	}

	// Irish exceptions.
	f.exceptions = []regexpPair{
		{regexp.MustCompile(`(^|\PL)MacEdo`), "${1}Macedo"},
		{regexp.MustCompile(`(^|\PL)MacEvicius`), "${1}Macevicius"},
		{regexp.MustCompile(`(^|\PL)MacHado`), "${1}Machado"},
		{regexp.MustCompile(`(^|\PL)MacHar`), "${1}Machar"},
		{regexp.MustCompile(`(^|\PL)MacHin`), "${1}Machin"},
		{regexp.MustCompile(`(^|\PL)MacHlin`), "${1}Machlin"},
		{regexp.MustCompile(`(^|\PL)MacIas`), "${1}Macias"},
		{regexp.MustCompile(`(^|\PL)MacIulis`), "${1}Maciulis"},
		{regexp.MustCompile(`(^|\PL)MacKie`), "${1}Mackie"},
		{regexp.MustCompile(`(^|\PL)MacKle`), "${1}Mackle"},
		{regexp.MustCompile(`(^|\PL)MacKlin`), "${1}Macklin"},
		{regexp.MustCompile(`(^|\PL)MacKmin`), "${1}Mackmin"},
		{regexp.MustCompile(`(^|\PL)MacQuarie`), "${1}Macquarie"},
		{regexp.MustCompile(`(^|\PL)MacOmber`), "${1}Macomber"},
		{regexp.MustCompile(`(^|\PL)MacIn`), "${1}Macin"},
		{regexp.MustCompile(`(^|\PL)MacKintosh`), "${1}Mackintosh"},
		{regexp.MustCompile(`(^|\PL)MacKen`), "${1}Macken"},
		{regexp.MustCompile(`(^|\PL)MacHen`), "${1}Machen"},
		{regexp.MustCompile(`(^|\PL)Macisaac`), "${1}MacIsaac"},
		{regexp.MustCompile(`(^|\PL)MacHiel`), "${1}Machiel"},
		{regexp.MustCompile(`(^|\PL)MacIol`), "${1}Maciol"},
		{regexp.MustCompile(`(^|\PL)MacKell`), "${1}Mackell"},
		{regexp.MustCompile(`(^|\PL)MacKlem`), "${1}Macklem"},
		{regexp.MustCompile(`(^|\PL)MacKrell`), "${1}Mackrell"},
		{regexp.MustCompile(`(^|\PL)MacLin`), "${1}Maclin"},
		{regexp.MustCompile(`(^|\PL)MacKey`), "${1}Mackey"},
		{regexp.MustCompile(`(^|\PL)MacKley`), "${1}Mackley"},
		{regexp.MustCompile(`(^|\PL)MacHell`), "${1}Machell"},
		{regexp.MustCompile(`(^|\PL)MacHon`), "${1}Machon"},
	}

	// General replacements.
	f.replacements = []regexpPair{
		{regexp.MustCompile(`(^|\PL)Al(\s+\pL)`), "${1}al${2}"},                // al Arabic or forename Al.
		{regexp.MustCompile(`(^|\PL)Ap($|\PL)`), "${1}ap${2}"},                 // ap Welsh.
		{regexp.MustCompile(`(^|\PL)(Bin|Binti|Binte)($|\PL)`), "${1}bin${3}"}, // bin, binti, binte Arabic.
		{regexp.MustCompile(`(^|\PL)Dell([ae])($|\PL)`), "${1}dell${2}${3}"},   // della and delle Italian.
		{regexp.MustCompile(`(^|\PL)D([aeiou])($|\PL)`), "${1}d${2}${3}"},      // da, de, di Italian; du French; do Brasil.
		{regexp.MustCompile(`(^|\PL)D([ao]s)($|\PL)`), "${1}d${2}${3}"},        // das, dos Brasileiros.
		{regexp.MustCompile(`(^|\PL)De([lrn])($|\PL)`), "${1}de${2}${3}"},      // del Italian; der/den Dutch/Flemish.
		{regexp.MustCompile(`(^|\PL)L([eo])($|\PL)`), "${1}l${2}${3}"},         // lo Italian; le French.
		{regexp.MustCompile(`(^|\PL)Te([rn])($|\PL)`), "${1}te${2}${3}"},       // ten, ter Dutch/Flemish.
		{regexp.MustCompile(`(^|\PL)Van(\s+\pL)`), "${1}van${2}"},              // van German or forename Van.
		{regexp.MustCompile(`(^|\PL)Von($|\PL)`), "${1}von${2}"},               // von Dutch/Flemish.
	}

	f.spanish = []regexpPair{
		{regexp.MustCompile(`(^|\PL)El($|\PL)`), "${1}el${2}"}, // el Greek or El Spanish.
		{regexp.MustCompile(`(^|\PL)La($|\PL)`), "${1}la${2}"}, // la French or La Spanish.
	}

	// Spanish conjunctions.
	f.conjunctions = []regexpPair{
		{regexp.MustCompile(`(^|\PL)Y($|\PL)`), "${1}y${2}"},
		{regexp.MustCompile(`(^|\PL)E($|\PL)`), "${1}e${2}"},
		{regexp.MustCompile(`(^|\PL)I($|\PL)`), "${1}i${2}"},
	}

	f.hebrew = []regexpPair{
		{regexp.MustCompile(`(^|\PL)Ben(\s+\pL)`), "${1}ben${2}"}, // ben Hebrew or forename Ben.
		{regexp.MustCompile(`(^|\PL)Bat(\s+\pL)`), "${1}bat${2}"}, // bat Hebrew or forename Bat.
	}

	// Roman letters regexp.
	f.romanRegexp = regexp.MustCompile(`(^|\PL)((?:[Xx]{1,3}|[Xx][Ll]|[Ll][Xx]{0,3})?(?:[Ii]{1,3}|[Ii][VvXx]|[Vv][Ii]{0,3})?)($|\PL)`)

	// Post nominal values.
	f.postNominals = make(map[string]*regexp.Regexp)
	for _, p := range []string{
		"ACILEx", "ACSM", "ADC", "AEPC", "AFC", "AFM", "AICSM", "AKC", "AM", "ARBRIBA", "ARCS", "ARRC", "ARSM", "AUH", "AUS",
		"BA", "BArch", "BCh", "BChir", "BCL", "BDS", "BEd", "BEM", "BEng", "BM", "BS", "BSc", "BSW", "BVM&S", "BVScBVetMed",
		"CB", "CBE", "CEng", "CertHE", "CGC", "CGM", "CH", "CIE", "CMarEngCMarSci", "CMarTech", "CMG", "CMILT", "CML", "CPhT", "CPLCTP", "CPM", "CQSW", "CSciTeach", "CSI", "CTL", "CVO",
		"DBE", "DBEnv", "DC", "DCB", "DCM", "DCMG", "DConstMgt", "DCVO", "DD", "DEM", "DFC", "DFM", "DIC", "Dip", "DipHE", "DipLP", "DipSW", "DL", "DLitt", "DLP", "DPhil", "DProf", "DPT", "DREst", "DSC", "DSM", "DSO", "DSocSci",
		"ED", "EdD", "EJLog", "EMLog", "EN", "EngD", "EngTech", "ERD", "ESLog",
		"FADO", "FAWM", "FBDOFCOptom", "FCEM", "FCILEx", "FCILT", "FCSP.", "FdAFdSc", "FdEng", "FFHOM", "FFPM", "FRCAFFPMRCA", "FRCGP", "FRCOG", "FRCP", "FRCPsych", "FRCS", "FRCVS", "FSCR.",
		"GBE", "GC", "GCB", "GCIE", "GCILEx", "GCMG", "GCSI", "GCVO", "GM",
		"HNC", "HNCert", "HND", "HNDip",
		"ICTTech", "IDSM", "IEng", "IMarEng", "IOMCPM", "ISO",
		"J", "JP", "JrLog",
		"KBE", "KC", "KCB", "KCIE", "KCMG", "KCSI", "KCVO", "KG", "KP", "KT",
		"LFHOM", "LG", "LJ", "LLB", "LLD", "LLM", "Log", "LPE", "LT", "LVO",
		"MA", "MAcc", "MAnth", "MArch", "MarEngTech", "MB", "MBA", "MBChB", "MBE", "MBEIOM", "MBiochem", "MC", "MCEM", "MCGI", "MCh.", "MChem", "MChiro", "MClinRes", "MComp", "MCOptom", "MCSM", "MCSP", "MD", "MEarthSc", "MEng", "MEnt", "MEP", "MFHOM", "MFin", "MFPM", "MGeol", "MILT", "MJur", "MLA", "MLitt", "MM", "MMath", "MMathStat", "MMORSE", "MMus", "MOst", "MP", "MPAMEd", "MPharm", "MPhil", "MPhys", "MRCGP", "MRCOG", "MRCP", "MRCPath", "MRCPCHFRCPCH", "MRCPsych", "MRCS", "MRCVS", "MRes", "MS", "MSc", "MScChiro", "MSci", "MSCR", "MSM", "MSocSc", "MSP", "MSt", "MSW", "MSYP", "MVO",
		"NPQH",
		"OBE", "OBI", "OM", "OND",
		"PgC", "PGCAP", "PGCE", "PgCert", "PGCHE", "PgCLTHE", "PgD", "PGDE", "PgDip", "PhD", "PLog", "PLS",
		"QAM", "QC", "QFSM", "QGM", "QHC", "QHDS", "QHNS", "QHP", "QHS", "QPM", "QS", "QTSCSci",
		"RD", "RFHN", "RGN", "RHV", "RIAI", "RIAS", "RM", "RMN", "RN", "RN1RNA", "RN2", "RN3", "RN4", "RN5", "RN6", "RN7", "RN8", "RN9", "RNC", "RNLD", "RNMH", "ROH", "RRC", "RSAW", "RSci", "RSciTech", "RSCN", "RSN", "RVM", "RVN",
		"SCHM", "SCJ", "SCLD", "SEN", "SGM", "SL", "SPANSPMH", "SPCC", "SPCN", "SPDN", "SPHP", "SPLD", "SrLog", "SRN", "SROT",
		"TD",
		"UD",
		"V100", "V200", "V300", "VC", "VD", "VetMB", "VN", "VRD",
	} {
		f.postNominals[p] = regexp.MustCompile(`(?i)(^|\PL)` + p + `($|\PL)`)
	}

	f.lowerCaseWords = []regexpPair{
		{regexp.MustCompile(`(^|\PL)The($|\PL)`), "${1}the${2}"},
		{regexp.MustCompile(`(^|\PL)Of($|\PL)`), "${1}of${2}"},
		{regexp.MustCompile(`(^|\PL)And($|\PL)`), "${1}and${2}"},
	}

	return f
}

// SetOptions sets the options for the formatter
func (f *Formatter) SetOptions(options Options) {
	f.options = options
}

// SetLazy sets the lazy option
func (f *Formatter) SetLazy(v bool) {
	f.options.Lazy = v
}

// SetIrish sets the irish option
func (f *Formatter) SetIrish(v bool) {
	f.options.Irish = v
}

// SetSpanish sets the spanish option
func (f *Formatter) SetSpanish(v bool) {
	f.options.Spanish = v
}

// SetRoman sets the roman option
func (f *Formatter) SetRoman(v bool) {
	f.options.Roman = v
}

// SetHebrew sets the hebrew option
func (f *Formatter) SetHebrew(v bool) {
	f.options.Hebrew = v
}

// SetPostNominal sets the post nominal option
func (f *Formatter) SetPostNominal(v bool) {
	f.options.PostNominal = v
}

// ExcludePostNominals is global post-nominals exclusions setter.
func (f *Formatter) ExcludePostNominals(values ...string) {
	for _, v := range values {
		delete(f.postNominals, v)
	}
}

// NameCase is the main function for NameCase
func (f Formatter) NameCase(name string) string {
	if len(name) == 0 {
		return name
	}

	if f.options.Lazy && f.skipMixed(name) {
		return name
	}

	name = f.capitalize(name)

	for _, r := range f.getReplacements() {
		name = r.regexp.ReplaceAllString(name, r.string)
	}

	name = f.correctLowerCaseWords(name)

	return f.processOptions(name)
}

// processOptions will process options with given name
func (f Formatter) processOptions(name string) string {
	if f.options.Roman {
		name = f.updateRoman(name)
	}

	if f.options.Spanish {
		name = f.fixConjunction(name)
	}

	if f.options.PostNominal {
		name = f.fixPostNominal(name)
	}

	return name
}

var firstLetterRegexp = regexp.MustCompile(`(^|\PL)\pL`)

// Lowercase 's
var sRegexp = regexp.MustCompile(`\'\pL($|\PL)`)

// capitalize will capitalize first letters
func (f Formatter) capitalize(name string) string {
	name = strings.ToLower(name)

	name = firstLetterRegexp.ReplaceAllStringFunc(name, strings.ToUpper)

	name = sRegexp.ReplaceAllStringFunc(name, strings.ToLower)

	name = f.updateIrish(name)

	return name
}

// getReplacements will define required replacements.
func (f Formatter) getReplacements() []regexpPair {
	replacements := f.replacements

	if !f.options.Spanish {
		replacements = append(replacements, f.spanish...)
	}

	if f.options.Hebrew {
		replacements = append(replacements, f.hebrew...)
	}

	return replacements
}

func isUpper(s string) bool {
	for _, r := range s {
		if !unicode.IsLetter(r) {
			continue
		}

		if !unicode.IsUpper(r) {
			return false
		}
	}
	return true
}

func isLower(s string) bool {
	for _, r := range s {
		if !unicode.IsLetter(r) {
			continue
		}

		if !unicode.IsLower(r) {
			return false
		}
	}
	return true
}

// skipMixed will skip if string is mixed case.
func (f Formatter) skipMixed(name string) bool {
	firstLetterLower := unicode.IsLower([]rune(name)[0])
	allLowerOrUpper := isUpper(name) || isLower(name)

	return !(firstLetterLower || allLowerOrUpper)
}

var macRegexp = regexp.MustCompile(`.*?\bMac[A-Za-z]{2,}[^aciozj]($|\PL)`)
var mcRegexp = regexp.MustCompile(`.*?\bMc`)

// updateIrish will update for Irish names
func (f Formatter) updateIrish(name string) string {
	if !f.options.Irish {
		return name
	}

	if macRegexp.MatchString(name) || mcRegexp.MatchString(name) {
		name = f.updateMac(name)
	}

	return strings.ReplaceAll(name, "Macmurdo", "MacMurdo")
}

// updateRoman will fix roman numeral names
func (f Formatter) updateRoman(name string) string {
	return f.romanRegexp.ReplaceAllStringFunc(name, strings.ToUpper)
}

var macReplRegexp = regexp.MustCompile(`(^|\PL)(Ma?c)(\pL+)`)

// updateMac updates irish Mac & Mc
func (f Formatter) updateMac(name string) string {
	name = replaceAllStringSubmatchFunc(macReplRegexp, name, func(s []string) string {
		return s[1] + s[2] + strings.ToUpper(s[3][:1]) + s[3][1:]
	})

	for _, r := range f.exceptions {
		name = r.regexp.ReplaceAllString(name, r.string)
	}

	return name
}

// fixConjunction will fix Spanish conjunctions
func (f Formatter) fixConjunction(name string) string {
	for _, r := range f.conjunctions {
		name = r.regexp.ReplaceAllString(name, r.string)
	}

	return name
}

// correctLowerCaseWords will correct lower-case words of titles
func (f Formatter) correctLowerCaseWords(name string) string {
	for _, r := range f.lowerCaseWords {
		name = r.regexp.ReplaceAllString(name, r.string)
	}

	return name
}

// fixPostNominal will fix post-nominal letter cases
func (f Formatter) fixPostNominal(name string) string {
	for p, r := range f.postNominals {
		name = r.ReplaceAllString(name, "${1}"+p+"${2}")
	}

	return name
}
