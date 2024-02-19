#include <stdio.h>
#include <stdlib.h>
// #include <iostream>
#include "HsFFI.h"
#include "potato.h"
#include "CardanoIbcHelper_stub.h"

void potatoInit(void){
  int argc = 2;
  char *argv[] = { (char *)"+RTS", (char *)"-A64m", NULL };
  char **pargv = argv;

  // Initialize Haskell runtime
  hs_init(&argc, &pargv);
}

void potatoExit(void){
  hs_exit();
}

