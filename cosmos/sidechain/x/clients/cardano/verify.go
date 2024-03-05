package cardano

/*
#include "CardanoIbcHelper_stub.h"
#include "Rts.h"
#include <stdio.h>
#include <stdlib.h>
#cgo LDFLAGS: -L${SRCDIR} -lcardano-ibc-helper -lHSrts-ghc8.10.7 -Wl,-rpath=${SRCDIR}
static void* allocArgv(int argc) {
    return malloc(sizeof(char *) * argc);
}

static void printArgs(int argc, char** argv) {
    int i;
    for (i = 0; i < argc; i++) {
        printf("%s\n", argv[i]);
    }
}

// init_hs is a convenience function not to mess around with pointers
// within Go itself.
static void init_hs(int argc, char** argv) {
	hs_init(&argc, &argv);
}
*/
import "C"
import (
	"encoding/hex"
	"fmt"
	"os"
	"unsafe"

	"github.com/fxamacker/cbor/v2"
)

func VerifyBlock(block BlockHexCbor) string {
	blockCbor, err := cbor.Marshal(block)
	if err != nil {
		fmt.Println("error:", err)
	}
	blockCborHex := hex.EncodeToString(blockCbor)

	// init Haskell
	argv := os.Args
	argc := C.int(len(argv))
	c_argv := (*[0xfff]*C.char)(C.allocArgv(argc))
	defer C.free(unsafe.Pointer(c_argv))

	for i, arg := range argv {
		c_argv[i] = C.CString(arg)
		defer C.free(unsafe.Pointer(c_argv[i]))
	}

	C.init_hs(argc, (**C.char)(unsafe.Pointer(c_argv)))
	// end init Haskell

	blockCborHexC := C.CString(blockCborHex)
	defer C.free(unsafe.Pointer(blockCborHexC))

	verifyBlockOutputCString := C.verifyBlock_hs(blockCborHexC)
	verifyBlockOutput := C.GoString(verifyBlockOutputCString)
	defer C.free(unsafe.Pointer(verifyBlockOutputCString))
	// var vOutput VerifyBlockOutput
	// err2 := cbor.Unmarshal(data, &vOutput)
	// if err2 != nil {
	// 	fmt.Println("error:", err)
	// }

	return verifyBlockOutput
}

func ExtractBlockData(blockCborHex string) string {

	// init Haskell
	argv := os.Args
	argc := C.int(len(argv))
	c_argv := (*[0xfff]*C.char)(C.allocArgv(argc))
	defer C.free(unsafe.Pointer(c_argv))

	for i, arg := range argv {
		c_argv[i] = C.CString(arg)
		defer C.free(unsafe.Pointer(c_argv[i]))
	}

	C.init_hs(argc, (**C.char)(unsafe.Pointer(c_argv)))
	// end init Haskell

	blockCborHexC := C.CString(blockCborHex)
	defer C.free(unsafe.Pointer(blockCborHexC))

	extractBlockOutputCString := C.extractBlockData_hs(blockCborHexC)
	extractBlockOutput := C.GoString(extractBlockOutputCString)
	defer C.free(unsafe.Pointer(extractBlockOutputCString))

	return extractBlockOutput
}
