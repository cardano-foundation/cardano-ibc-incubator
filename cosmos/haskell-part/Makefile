GHC_INCLUDE_PATH := $$(bash ghc --print-libdir)/include/:
all: 
	make buildSo
	make buildGo

buildSo:
	cabal build cardano-ibc-helper
	find dist-newstyle/ -name 'libcardano-ibc-helper.*' -exec cp {} ../go/ \;
	sed -i 's/HsPtr/const char*/g' ../go/CardanoIbcHelper_stub.h

buildGo:
	# rm -f go/haskellgo && cd go && C_INCLUDE_PATH=$$C_INCLUDE_PATH:$(GHC_INCLUDE_PATH) go build -buildvcs=false && ./haskellgo
	rm -f ../go/haskellgo && cd ../go && C_INCLUDE_PATH=$$C_INCLUDE_PATH:$(GHC_INCLUDE_PATH) go build -buildvcs=false -a && ./haskellgo