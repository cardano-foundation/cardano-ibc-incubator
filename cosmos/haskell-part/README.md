 0) 
    - install ghc: https://www.haskell.org/ghcup/
    - ghcup install ghc 8.10.7 && ghcup set ghc 8.10.7
    - ghcup install cabal 3.8.1.0 && ghcup set cabal 3.8.1.0
    - ghcup install hls 2.2.0.0 && ghcup set hls 2.2.0.0
    - open go/main.go and change /home/huynq/.ghcup to the correct .ghcup folder 

## Using make:
1) Run "make" at root folder

## Manual:
1) Build with: cabal build cardano-ibc-helper -v
2) Copy .so file: find dist-newstyle/ -name 'libcardano-ibc-helper.*' -exec cp {} ./go/ \;
3) Open go/Potato_stub.h and change "HsPtr" to "const char*" 
    sed -i 's/HsPtr/const char*/g' go/Potato_stub.h
4) Find libdir: bash ghc --print-libdir 
```sh
bash ghc --print-libdir 

Output:
/home/xxx/.ghcup/ghc/8.10.7/lib/ghc-8.10.7

Include folder will be: /home/huynq/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include/
```
4) Run: 
```sh
cd go && C_INCLUDE_PATH=${include folder} go build -v && ./haskellgo

Example:
cd go && C_INCLUDE_PATH=/home/xxx/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include/ go build -v && ./haskellgo
```

Issues:

[v] Need to install much things, also need to hardcoded .ghcup path (.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include/, .ghcup/ghc/8.10.7/lib/ghc-8.10.7/rts)
    => using ghc --print-libdir 

[v] Still not find a way to move .so to seperate folder in side ./go (like ./go/lib)

[ ] Still need to copy libHSrts-ghc8.10.7.so to current ./go folder
