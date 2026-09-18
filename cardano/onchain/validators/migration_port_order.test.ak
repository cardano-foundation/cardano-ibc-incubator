use aiken/builtin
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateControl, HostStateDatum,
}
use ibc/migration/types.{Authority, Begin, Emergency, Registry}
use implementation_registry

// The captured historical transaction used the seven-field test registry.
// Adapt only this isolated fixture to the fresh baseline ABI; this is NOT a
// transaction claiming recovery of that historical deployment.
fn baseline_registry(raw: Data) -> Data {
  let Pair(tag, fields) = builtin.un_constr_data(raw)
  expect list.length(fields) == 7
  let emergency: Data =
    Emergency {
      authority: Authority {
        signers: [#"99999999999999999999999999999999999999999999999999999999"],
        quorum: 1,
      },
      epoch: 0,
      mask: 0,
      restoration: None,
    }
  builtin.constr_data(tag, list.concat(fields, [emergency]))
}

fn begin_with_port_order(reordered: Bool) {
  let raw: Data =
    builtin.constr_data(
      0,
      [
        builtin.constr_data(
          0,
          [
            builtin.b_data(
              #"3a562e26e691319456a3b599b35d0ddebe67c1088387afc04b60861f",
            ),
            builtin.b_data(
              #"6962635f696d706c656d656e746174696f6e5f7265676973747279",
            ),
          ],
        ),
        builtin.b_data(
          #"5b06aef44cc1492d772ba49b61f8591abd49ed09a0330d30572337c9",
        ),
        builtin.constr_data(
          0,
          [
            builtin.b_data(
              #"f5ae706d02eaacfd095c4d43cec90788c7329727e51762c08cf44c4b",
            ),
            builtin.b_data(
              #"cfbf6f80727eb23e93bf7b6d105061ecaaf372a07e3feb74ee4b6ce8",
            ),
            builtin.b_data(
              #"164c50f177229b3a27f63b6eb5b2d3014d620f3444dfc84ff24461dc",
            ),
            builtin.b_data(
              #"c26bc0675ac931210c4b8894bb2cb908bda540c969d88a2ab2c5339b",
            ),
            builtin.constr_data(
              0,
              [
                builtin.constr_data(
                  1,
                  [
                    builtin.b_data(
                      #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
                    ),
                  ],
                ),
                builtin.constr_data(1, []),
              ],
            ),
          ],
        ),
        builtin.constr_data(
          0,
          [
            builtin.list_data(
              [
                builtin.b_data(
                  #"0fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42",
                ),
              ],
            ),
            builtin.i_data(1),
            builtin.i_data(86400000),
          ],
        ),
        builtin.i_data(1),
        builtin.constr_data(
          0,
          [
            builtin.i_data(1),
            builtin.list_data(
              [
                builtin.constr_data(
                  0,
                  [
                    builtin.constr_data(
                      1,
                      [
                        builtin.b_data(
                          #"aa38e422fd6bbc82735d73ee01da349a6bfad98baa4d5acaebd94a56",
                        ),
                      ],
                    ),
                    builtin.constr_data(1, []),
                  ],
                ),
                builtin.constr_data(
                  0,
                  [
                    builtin.constr_data(
                      1,
                      [
                        builtin.b_data(
                          #"412c2260c4109ab517355e565a4a2bae2cddeda0fa140be987048e76",
                        ),
                      ],
                    ),
                    builtin.constr_data(1, []),
                  ],
                ),
                builtin.constr_data(
                  0,
                  [
                    builtin.constr_data(
                      1,
                      [
                        builtin.b_data(
                          #"7208f7390203d02f31f7dfd83772bf74a103a832174a6b5234a1e540",
                        ),
                      ],
                    ),
                    builtin.constr_data(1, []),
                  ],
                ),
                builtin.constr_data(
                  0,
                  [
                    builtin.constr_data(
                      1,
                      [
                        builtin.b_data(
                          #"a3094f4e77fbbbf2f268ddcdbd4d13807d593b38591f38e4e204c68f",
                        ),
                      ],
                    ),
                    builtin.constr_data(1, []),
                  ],
                ),
                builtin.constr_data(
                  0,
                  [
                    builtin.constr_data(
                      1,
                      [
                        builtin.b_data(
                          #"74787d635e3fcbbef9a7708241d03e8888ae8ad889b0bbbb39cc7532",
                        ),
                      ],
                    ),
                    builtin.constr_data(1, []),
                  ],
                ),
              ],
            ),
            builtin.b_data(
              #"4d7c4b0af6a85b2b04aef524aa05a0bc5f1e1801cc3cd5360b99561a091cfd86",
            ),
          ],
        ),
        builtin.constr_data(
          1,
          [
            builtin.constr_data(
              0,
              [
                builtin.i_data(1),
                builtin.i_data(1),
                builtin.constr_data(
                  0,
                  [
                    builtin.i_data(2),
                    builtin.list_data(
                      [
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"b86fb2f3823fada9ca9525369a8a816d791c76f84b4389598d88f40d",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"0b5e2567f093a76a27971f857a39d9808e4b8609c41e68d0b7812b6d",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"92336e658333db2339bcf60aed2bb6fd13ef2f90f191ae8d450eba0d",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"570846e3aec7b83fb5f931991f8da39bdcb28cc40d99171bed08540e",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"175843bd350b6e625b6b3607867671366f3dc98503ea3b81f9cadb35",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                      ],
                    ),
                    builtin.b_data(
                      #"4d7c4b0af6a85b2b04aef524aa05a0bc5f1e1801cc3cd5360b99561a091cfd86",
                    ),
                  ],
                ),
                builtin.constr_data(
                  0,
                  [builtin.i_data(0), builtin.i_data(0), builtin.i_data(0)],
                ),
                builtin.b_data(
                  #"0000000000000000000000000000000000000000000000000000000000000000",
                ),
              ],
            ),
            builtin.i_data(1789692709000),
            builtin.i_data(1789865449000),
          ],
        ),
      ],
    )
  expect old: Registry = baseline_registry(raw)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input {
          output_reference: OutputReference {
            transaction_id: #"5a4a849834897059d81a064a35f86733fb888740c61aa73ef89926eca1c949c5",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"aa38e422fd6bbc82735d73ee01da349a6bfad98baa4d5acaebd94a56",
              ),
              None,
            ),
            value: assets.from_lovelace(3879000)
              |> assets.add(
                  #"5b06aef44cc1492d772ba49b61f8591abd49ed09a0330d30572337c9",
                  #"6962635f686f73745f7374617465",
                  1,
                ),
            datum: InlineDatum(
              builtin.constr_data(
                0,
                [
                  builtin.constr_data(
                    0,
                    [
                      builtin.i_data(3),
                      builtin.b_data(
                        #"201b069a5f273b94c89d514228d004e43ff833839dfe540ab4cc8b6e4dae5321",
                      ),
                      builtin.i_data(0),
                      builtin.i_data(0),
                      builtin.i_data(0),
                      builtin.list_data([]),
                      builtin.i_data(1789604891071),
                    ],
                  ),
                  builtin.b_data(
                    #"5b06aef44cc1492d772ba49b61f8591abd49ed09a0330d30572337c9",
                  ),
                  builtin.b_data(
                    #"0fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42",
                  ),
                  builtin.constr_data(
                    0,
                    [
                      builtin.map_data(
                        [
                          Pair(
                            builtin.b_data(#"6d6f636b"),
                            builtin.constr_data(
                              0,
                              [
                                builtin.b_data(
                                  #"d20ef715e9f8d0e3b33944218fff5356fd6770234bdc635bd8f7a450",
                                ),
                                builtin.constr_data(
                                  0,
                                  [
                                    builtin.b_data(
                                      #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                                    ),
                                    builtin.b_data(
                                      #"1fa5962b824eab9f759c65f1a933c3a70cb9946f1173c626ff79b8eb6dfdeafb",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(
                                  0,
                                  [
                                    builtin.b_data(
                                      #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                                    ),
                                    builtin.b_data(
                                      #"c8d0305611046c66254f3f4418c885b22472331b3386b9e79767de3aa5a17b96",
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          Pair(
                            builtin.b_data(#"696371686f7374"),
                            builtin.constr_data(
                              0,
                              [
                                builtin.b_data(
                                  #"d20ef715e9f8d0e3b33944218fff5356fd6770234bdc635bd8f7a450",
                                ),
                                builtin.constr_data(
                                  0,
                                  [
                                    builtin.b_data(
                                      #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                                    ),
                                    builtin.b_data(
                                      #"5ba069759e53066201674e133b98385b6c4dcee9c9b96811482df5405c9a87a2",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(
                                  0,
                                  [
                                    builtin.b_data(
                                      #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                                    ),
                                    builtin.b_data(
                                      #"deea0589ffef2cf2c4c1ea99a5ed50abdeaca8a7d5e9e6e8855ac8a29820a366",
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          Pair(
                            builtin.b_data(#"7472616e73666572"),
                            builtin.constr_data(
                              0,
                              [
                                builtin.b_data(
                                  #"74787d635e3fcbbef9a7708241d03e8888ae8ad889b0bbbb39cc7532",
                                ),
                                builtin.constr_data(
                                  0,
                                  [
                                    builtin.b_data(
                                      #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                                    ),
                                    builtin.b_data(
                                      #"04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(
                                  0,
                                  [
                                    builtin.b_data(
                                      #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                                    ),
                                    builtin.b_data(
                                      #"ae10362a054bea53a012714ce7a80f6520a346f98059bedb8f80dfb47aa60850",
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      builtin.constr_data(0, []),
                    ],
                  ),
                ],
              ),
            ),
            reference_script: None,
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"6dabbdc0b6aa63805287265319bea23df26ab979da261fa8aa09997172e2b1d0",
            output_index: 1,
          },
          output: Output {
            address: Address(
              VerificationKey(
                #"0fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42",
              ),
              Some(
                Inline(
                  VerificationKey(
                    #"e557890352095f1cf6fd2b7d1a28e3c3cb029f48cf34ff890a28d176",
                  ),
                ),
              ),
            ),
            value: assets.from_lovelace(198584977),
            datum: NoDatum,
            reference_script: None,
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"a738e1301cfeab2ba62f51977af9a7e963b60d166142ac681b8c0e97fd6c69a5",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"443ccc52ae352ff74dc2befe97c0ab1ab6dc53e6f021404ce6b4c2ac",
              ),
              None,
            ),
            value: assets.from_lovelace(4896160)
              |> assets.add(
                  #"3a562e26e691319456a3b599b35d0ddebe67c1088387afc04b60861f",
                  #"6962635f696d706c656d656e746174696f6e5f7265676973747279",
                  1,
                ),
            datum: InlineDatum(
              builtin.constr_data(
                0,
                [
                  builtin.constr_data(
                    0,
                    [
                      builtin.b_data(
                        #"3a562e26e691319456a3b599b35d0ddebe67c1088387afc04b60861f",
                      ),
                      builtin.b_data(
                        #"6962635f696d706c656d656e746174696f6e5f7265676973747279",
                      ),
                    ],
                  ),
                  builtin.b_data(
                    #"5b06aef44cc1492d772ba49b61f8591abd49ed09a0330d30572337c9",
                  ),
                  builtin.constr_data(
                    0,
                    [
                      builtin.b_data(
                        #"f5ae706d02eaacfd095c4d43cec90788c7329727e51762c08cf44c4b",
                      ),
                      builtin.b_data(
                        #"cfbf6f80727eb23e93bf7b6d105061ecaaf372a07e3feb74ee4b6ce8",
                      ),
                      builtin.b_data(
                        #"164c50f177229b3a27f63b6eb5b2d3014d620f3444dfc84ff24461dc",
                      ),
                      builtin.b_data(
                        #"c26bc0675ac931210c4b8894bb2cb908bda540c969d88a2ab2c5339b",
                      ),
                      builtin.constr_data(
                        0,
                        [
                          builtin.constr_data(
                            1,
                            [
                              builtin.b_data(
                                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
                              ),
                            ],
                          ),
                          builtin.constr_data(1, []),
                        ],
                      ),
                    ],
                  ),
                  builtin.constr_data(
                    0,
                    [
                      builtin.list_data(
                        [
                          builtin.b_data(
                            #"0fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42",
                          ),
                        ],
                      ),
                      builtin.i_data(1),
                      builtin.i_data(86400000),
                    ],
                  ),
                  builtin.i_data(1),
                  builtin.constr_data(
                    0,
                    [
                      builtin.i_data(1),
                      builtin.list_data(
                        [
                          builtin.constr_data(
                            0,
                            [
                              builtin.constr_data(
                                1,
                                [
                                  builtin.b_data(
                                    #"aa38e422fd6bbc82735d73ee01da349a6bfad98baa4d5acaebd94a56",
                                  ),
                                ],
                              ),
                              builtin.constr_data(1, []),
                            ],
                          ),
                          builtin.constr_data(
                            0,
                            [
                              builtin.constr_data(
                                1,
                                [
                                  builtin.b_data(
                                    #"412c2260c4109ab517355e565a4a2bae2cddeda0fa140be987048e76",
                                  ),
                                ],
                              ),
                              builtin.constr_data(1, []),
                            ],
                          ),
                          builtin.constr_data(
                            0,
                            [
                              builtin.constr_data(
                                1,
                                [
                                  builtin.b_data(
                                    #"7208f7390203d02f31f7dfd83772bf74a103a832174a6b5234a1e540",
                                  ),
                                ],
                              ),
                              builtin.constr_data(1, []),
                            ],
                          ),
                          builtin.constr_data(
                            0,
                            [
                              builtin.constr_data(
                                1,
                                [
                                  builtin.b_data(
                                    #"a3094f4e77fbbbf2f268ddcdbd4d13807d593b38591f38e4e204c68f",
                                  ),
                                ],
                              ),
                              builtin.constr_data(1, []),
                            ],
                          ),
                          builtin.constr_data(
                            0,
                            [
                              builtin.constr_data(
                                1,
                                [
                                  builtin.b_data(
                                    #"74787d635e3fcbbef9a7708241d03e8888ae8ad889b0bbbb39cc7532",
                                  ),
                                ],
                              ),
                              builtin.constr_data(1, []),
                            ],
                          ),
                        ],
                      ),
                      builtin.b_data(
                        #"4d7c4b0af6a85b2b04aef524aa05a0bc5f1e1801cc3cd5360b99561a091cfd86",
                      ),
                    ],
                  ),
                  builtin.constr_data(
                    1,
                    [
                      builtin.constr_data(
                        0,
                        [
                          builtin.i_data(1),
                          builtin.i_data(1),
                          builtin.constr_data(
                            0,
                            [
                              builtin.i_data(2),
                              builtin.list_data(
                                [
                                  builtin.constr_data(
                                    0,
                                    [
                                      builtin.constr_data(
                                        1,
                                        [
                                          builtin.b_data(
                                            #"b86fb2f3823fada9ca9525369a8a816d791c76f84b4389598d88f40d",
                                          ),
                                        ],
                                      ),
                                      builtin.constr_data(1, []),
                                    ],
                                  ),
                                  builtin.constr_data(
                                    0,
                                    [
                                      builtin.constr_data(
                                        1,
                                        [
                                          builtin.b_data(
                                            #"0b5e2567f093a76a27971f857a39d9808e4b8609c41e68d0b7812b6d",
                                          ),
                                        ],
                                      ),
                                      builtin.constr_data(1, []),
                                    ],
                                  ),
                                  builtin.constr_data(
                                    0,
                                    [
                                      builtin.constr_data(
                                        1,
                                        [
                                          builtin.b_data(
                                            #"92336e658333db2339bcf60aed2bb6fd13ef2f90f191ae8d450eba0d",
                                          ),
                                        ],
                                      ),
                                      builtin.constr_data(1, []),
                                    ],
                                  ),
                                  builtin.constr_data(
                                    0,
                                    [
                                      builtin.constr_data(
                                        1,
                                        [
                                          builtin.b_data(
                                            #"570846e3aec7b83fb5f931991f8da39bdcb28cc40d99171bed08540e",
                                          ),
                                        ],
                                      ),
                                      builtin.constr_data(1, []),
                                    ],
                                  ),
                                  builtin.constr_data(
                                    0,
                                    [
                                      builtin.constr_data(
                                        1,
                                        [
                                          builtin.b_data(
                                            #"175843bd350b6e625b6b3607867671366f3dc98503ea3b81f9cadb35",
                                          ),
                                        ],
                                      ),
                                      builtin.constr_data(1, []),
                                    ],
                                  ),
                                ],
                              ),
                              builtin.b_data(
                                #"4d7c4b0af6a85b2b04aef524aa05a0bc5f1e1801cc3cd5360b99561a091cfd86",
                              ),
                            ],
                          ),
                          builtin.constr_data(
                            0,
                            [
                              builtin.i_data(0),
                              builtin.i_data(0),
                              builtin.i_data(0),
                            ],
                          ),
                          builtin.b_data(
                            #"0000000000000000000000000000000000000000000000000000000000000000",
                          ),
                        ],
                      ),
                      builtin.i_data(1789692709000),
                      builtin.i_data(1789865449000),
                    ],
                  ),
                ],
              ),
            ),
            reference_script: None,
          },
        },
      ],
      reference_inputs: [
        Input {
          output_reference: OutputReference {
            transaction_id: #"4108e556ba6c074982aa6872be312e6b6d963f6cd4a52cc82c8964b031ff9029",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
              ),
              None,
            ),
            value: assets.from_lovelace(44720560),
            datum: InlineDatum(builtin.constr_data(0, [])),
            reference_script: Some(
              #"443ccc52ae352ff74dc2befe97c0ab1ab6dc53e6f021404ce6b4c2ac",
            ),
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"8e24dac8eb973201c96534d71c65fa7d5779146ca3218c05030a983e008f656a",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
              ),
              None,
            ),
            value: assets.from_lovelace(68688470),
            datum: InlineDatum(builtin.constr_data(0, [])),
            reference_script: Some(
              #"aa38e422fd6bbc82735d73ee01da349a6bfad98baa4d5acaebd94a56",
            ),
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"47293eca3873d6a86ce851029254bd3ddf37efa2e0d2e61687710c03ebea6fd3",
            output_index: 1,
          },
          output: Output {
            address: Address(
              Script(
                #"74787d635e3fcbbef9a7708241d03e8888ae8ad889b0bbbb39cc7532",
              ),
              None,
            ),
            value: assets.from_lovelace(1624870)
              |> assets.add(
                  #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                  #"ae10362a054bea53a012714ce7a80f6520a346f98059bedb8f80dfb47aa60850",
                  1,
                )
              |> assets.add(
                  #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                  #"04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
                  1,
                ),
            datum: InlineDatum(
              builtin.constr_data(
                0,
                [
                  builtin.b_data(
                    #"0000000000000000000000000000000000000000000000000000000000000000",
                  ),
                ],
              ),
            ),
            reference_script: None,
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"5be2a4377d9f1b8eff6e537147d0d5685a0a42103c8fe967a24caa9ec9b17d48",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
              ),
              None,
            ),
            value: assets.from_lovelace(68688470),
            datum: InlineDatum(builtin.constr_data(0, [])),
            reference_script: Some(
              #"b86fb2f3823fada9ca9525369a8a816d791c76f84b4389598d88f40d",
            ),
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"893ccc5c4d468a44c9adc78cd6f1503a8d935c07da3d0bdb8d053ceab07235f4",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
              ),
              None,
            ),
            value: assets.from_lovelace(68490210),
            datum: InlineDatum(builtin.constr_data(0, [])),
            reference_script: Some(
              #"0b5e2567f093a76a27971f857a39d9808e4b8609c41e68d0b7812b6d",
            ),
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"32859cd7adf2d7262a4017f9c4f868f9e028b286cd83f9622c6d3bdc14077fea",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
              ),
              None,
            ),
            value: assets.from_lovelace(52577690),
            datum: InlineDatum(builtin.constr_data(0, [])),
            reference_script: Some(
              #"92336e658333db2339bcf60aed2bb6fd13ef2f90f191ae8d450eba0d",
            ),
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"fd3351d474ba9357a8cef6c11177ecc92489281713602e3154b9762ea779ce49",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
              ),
              None,
            ),
            value: assets.from_lovelace(24985070),
            datum: InlineDatum(builtin.constr_data(0, [])),
            reference_script: Some(
              #"570846e3aec7b83fb5f931991f8da39bdcb28cc40d99171bed08540e",
            ),
          },
        },
        Input {
          output_reference: OutputReference {
            transaction_id: #"e8c74582651cb708025900b34525b07fed3b339e350effa306163fac0cf243d9",
            output_index: 0,
          },
          output: Output {
            address: Address(
              Script(
                #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
              ),
              None,
            ),
            value: assets.from_lovelace(68619510),
            datum: InlineDatum(builtin.constr_data(0, [])),
            reference_script: Some(
              #"175843bd350b6e625b6b3607867671366f3dc98503ea3b81f9cadb35",
            ),
          },
        },
      ],
      outputs: [
        Output {
          address: Address(
            Script(#"443ccc52ae352ff74dc2befe97c0ab1ab6dc53e6f021404ce6b4c2ac"),
            None,
          ),
          value: assets.from_lovelace(5568520)
            |> assets.add(
                #"3a562e26e691319456a3b599b35d0ddebe67c1088387afc04b60861f",
                #"6962635f696d706c656d656e746174696f6e5f7265676973747279",
                1,
              ),
          datum: InlineDatum(
            builtin.constr_data(
              0,
              [
                builtin.constr_data(
                  0,
                  [
                    builtin.b_data(
                      #"3a562e26e691319456a3b599b35d0ddebe67c1088387afc04b60861f",
                    ),
                    builtin.b_data(
                      #"6962635f696d706c656d656e746174696f6e5f7265676973747279",
                    ),
                  ],
                ),
                builtin.b_data(
                  #"5b06aef44cc1492d772ba49b61f8591abd49ed09a0330d30572337c9",
                ),
                builtin.constr_data(
                  0,
                  [
                    builtin.b_data(
                      #"f5ae706d02eaacfd095c4d43cec90788c7329727e51762c08cf44c4b",
                    ),
                    builtin.b_data(
                      #"cfbf6f80727eb23e93bf7b6d105061ecaaf372a07e3feb74ee4b6ce8",
                    ),
                    builtin.b_data(
                      #"164c50f177229b3a27f63b6eb5b2d3014d620f3444dfc84ff24461dc",
                    ),
                    builtin.b_data(
                      #"c26bc0675ac931210c4b8894bb2cb908bda540c969d88a2ab2c5339b",
                    ),
                    builtin.constr_data(
                      0,
                      [
                        builtin.constr_data(
                          1,
                          [
                            builtin.b_data(
                              #"c93d69d5b4861021af990251d15279fe1221a8a11a1088c25e8dc4d9",
                            ),
                          ],
                        ),
                        builtin.constr_data(1, []),
                      ],
                    ),
                  ],
                ),
                builtin.constr_data(
                  0,
                  [
                    builtin.list_data(
                      [
                        builtin.b_data(
                          #"0fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42",
                        ),
                      ],
                    ),
                    builtin.i_data(1),
                    builtin.i_data(86400000),
                  ],
                ),
                builtin.i_data(1),
                builtin.constr_data(
                  0,
                  [
                    builtin.i_data(1),
                    builtin.list_data(
                      [
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"aa38e422fd6bbc82735d73ee01da349a6bfad98baa4d5acaebd94a56",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"412c2260c4109ab517355e565a4a2bae2cddeda0fa140be987048e76",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"7208f7390203d02f31f7dfd83772bf74a103a832174a6b5234a1e540",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"a3094f4e77fbbbf2f268ddcdbd4d13807d593b38591f38e4e204c68f",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.constr_data(
                              1,
                              [
                                builtin.b_data(
                                  #"74787d635e3fcbbef9a7708241d03e8888ae8ad889b0bbbb39cc7532",
                                ),
                              ],
                            ),
                            builtin.constr_data(1, []),
                          ],
                        ),
                      ],
                    ),
                    builtin.b_data(
                      #"4d7c4b0af6a85b2b04aef524aa05a0bc5f1e1801cc3cd5360b99561a091cfd86",
                    ),
                  ],
                ),
                builtin.constr_data(
                  2,
                  [
                    builtin.constr_data(
                      0,
                      [
                        builtin.i_data(2),
                        builtin.list_data(
                          [
                            builtin.constr_data(
                              0,
                              [
                                builtin.constr_data(
                                  1,
                                  [
                                    builtin.b_data(
                                      #"b86fb2f3823fada9ca9525369a8a816d791c76f84b4389598d88f40d",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(1, []),
                              ],
                            ),
                            builtin.constr_data(
                              0,
                              [
                                builtin.constr_data(
                                  1,
                                  [
                                    builtin.b_data(
                                      #"0b5e2567f093a76a27971f857a39d9808e4b8609c41e68d0b7812b6d",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(1, []),
                              ],
                            ),
                            builtin.constr_data(
                              0,
                              [
                                builtin.constr_data(
                                  1,
                                  [
                                    builtin.b_data(
                                      #"92336e658333db2339bcf60aed2bb6fd13ef2f90f191ae8d450eba0d",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(1, []),
                              ],
                            ),
                            builtin.constr_data(
                              0,
                              [
                                builtin.constr_data(
                                  1,
                                  [
                                    builtin.b_data(
                                      #"570846e3aec7b83fb5f931991f8da39bdcb28cc40d99171bed08540e",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(1, []),
                              ],
                            ),
                            builtin.constr_data(
                              0,
                              [
                                builtin.constr_data(
                                  1,
                                  [
                                    builtin.b_data(
                                      #"175843bd350b6e625b6b3607867671366f3dc98503ea3b81f9cadb35",
                                    ),
                                  ],
                                ),
                                builtin.constr_data(1, []),
                              ],
                            ),
                          ],
                        ),
                        builtin.b_data(
                          #"4d7c4b0af6a85b2b04aef524aa05a0bc5f1e1801cc3cd5360b99561a091cfd86",
                        ),
                      ],
                    ),
                    builtin.constr_data(
                      0,
                      [builtin.i_data(0), builtin.i_data(0), builtin.i_data(0)],
                    ),
                    builtin.constr_data(
                      0,
                      [builtin.i_data(0), builtin.i_data(0), builtin.i_data(0)],
                    ),
                    builtin.constr_data(
                      0,
                      [
                        builtin.b_data(
                          #"74787d635e3fcbbef9a7708241d03e8888ae8ad889b0bbbb39cc7532",
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.b_data(
                              #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                            ),
                            builtin.b_data(
                              #"04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
                            ),
                          ],
                        ),
                        builtin.constr_data(
                          0,
                          [
                            builtin.b_data(
                              #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                            ),
                            builtin.b_data(
                              #"ae10362a054bea53a012714ce7a80f6520a346f98059bedb8f80dfb47aa60850",
                            ),
                          ],
                        ),
                      ],
                    ),
                    builtin.b_data(
                      #"0000000000000000000000000000000000000000000000000000000000000000",
                    ),
                    builtin.constr_data(0, []),
                  ],
                ),
              ],
            ),
          ),
          reference_script: None,
        },
        Output {
          address: Address(
            Script(#"b86fb2f3823fada9ca9525369a8a816d791c76f84b4389598d88f40d"),
            None,
          ),
          value: assets.from_lovelace(3935030)
            |> assets.add(
                #"5b06aef44cc1492d772ba49b61f8591abd49ed09a0330d30572337c9",
                #"6962635f686f73745f7374617465",
                1,
              ),
          datum: InlineDatum(
            builtin.constr_data(
              0,
              [
                builtin.constr_data(
                  0,
                  [
                    builtin.i_data(4),
                    builtin.b_data(
                      #"201b069a5f273b94c89d514228d004e43ff833839dfe540ab4cc8b6e4dae5321",
                    ),
                    builtin.i_data(0),
                    builtin.i_data(0),
                    builtin.i_data(0),
                    builtin.list_data([]),
                    builtin.i_data(1789692829000),
                  ],
                ),
                builtin.b_data(
                  #"5b06aef44cc1492d772ba49b61f8591abd49ed09a0330d30572337c9",
                ),
                builtin.b_data(
                  #"0fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42",
                ),
                builtin.constr_data(
                  0,
                  [
                    builtin.map_data(
                      [
                        Pair(
                          builtin.b_data(#"696371686f7374"),
                          builtin.constr_data(
                            0,
                            [
                              builtin.b_data(
                                #"d20ef715e9f8d0e3b33944218fff5356fd6770234bdc635bd8f7a450",
                              ),
                              builtin.constr_data(
                                0,
                                [
                                  builtin.b_data(
                                    #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                                  ),
                                  builtin.b_data(
                                    #"5ba069759e53066201674e133b98385b6c4dcee9c9b96811482df5405c9a87a2",
                                  ),
                                ],
                              ),
                              builtin.constr_data(
                                0,
                                [
                                  builtin.b_data(
                                    #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                                  ),
                                  builtin.b_data(
                                    #"deea0589ffef2cf2c4c1ea99a5ed50abdeaca8a7d5e9e6e8855ac8a29820a366",
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Pair(
                          builtin.b_data(#"6d6f636b"),
                          builtin.constr_data(
                            0,
                            [
                              builtin.b_data(
                                #"d20ef715e9f8d0e3b33944218fff5356fd6770234bdc635bd8f7a450",
                              ),
                              builtin.constr_data(
                                0,
                                [
                                  builtin.b_data(
                                    #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                                  ),
                                  builtin.b_data(
                                    #"1fa5962b824eab9f759c65f1a933c3a70cb9946f1173c626ff79b8eb6dfdeafb",
                                  ),
                                ],
                              ),
                              builtin.constr_data(
                                0,
                                [
                                  builtin.b_data(
                                    #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                                  ),
                                  builtin.b_data(
                                    #"c8d0305611046c66254f3f4418c885b22472331b3386b9e79767de3aa5a17b96",
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Pair(
                          builtin.b_data(#"7472616e73666572"),
                          builtin.constr_data(
                            0,
                            [
                              builtin.b_data(
                                #"74787d635e3fcbbef9a7708241d03e8888ae8ad889b0bbbb39cc7532",
                              ),
                              builtin.constr_data(
                                0,
                                [
                                  builtin.b_data(
                                    #"c371f90846e40cafac7ec92a46a75263b3fad7eca5ecee35b1458cd9",
                                  ),
                                  builtin.b_data(
                                    #"04c1bb73a4a1a77a59b16e461d6ea244bac88d36050557ba026d36f46dd0f873",
                                  ),
                                ],
                              ),
                              builtin.constr_data(
                                0,
                                [
                                  builtin.b_data(
                                    #"10c74a58c20630e59064d7bb9cc8e6af1df48e07898282f75a962b98",
                                  ),
                                  builtin.b_data(
                                    #"ae10362a054bea53a012714ce7a80f6520a346f98059bedb8f80dfb47aa60850",
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    builtin.constr_data(0, []),
                  ],
                ),
              ],
            ),
          ),
          reference_script: None,
        },
        Output {
          address: Address(
            VerificationKey(
              #"0fdc780023d8be7c9ff3a6bdc0d8d3b263bd0cc12448c40948efbf42",
            ),
            Some(
              Inline(
                VerificationKey(
                  #"e557890352095f1cf6fd2b7d1a28e3c3cb029f48cf34ff890a28d176",
                ),
              ),
            ),
          ),
          value: assets.from_lovelace(195819777),
          datum: NoDatum,
          reference_script: None,
        },
      ],
      validity_range: interval.between(1789692769000, 1789692829000),
    }
  let adapt =
    fn(output: Output) {
      if assets.quantity_of(output.value, old.token.policy_id, old.token.name) == 1 {
        expect InlineDatum(datum) = output.datum
        Output { ..output, datum: InlineDatum(baseline_registry(datum)) }
      } else {
        output
      }
    }
  let tx =
    Transaction {
      ..tx,
      inputs: list.map(
        tx.inputs,
        fn(input) { Input { ..input, output: adapt(input.output) } },
      ),
      outputs: list.map(tx.outputs, adapt),
    }
  // Restore just the original map; every other datum field and transaction
  // component remains the same in the positive and negative controls.
  let tx =
    if reordered {
      tx
    } else {
      expect Some(source) =
        list.find(
          tx.inputs,
          fn(input) {
            assets.quantity_of(
              input.output.value,
              old.host_policy,
              #"6962635f686f73745f7374617465",
            ) == 1
          },
        )
      expect InlineDatum(source_data) = source.output.datum
      expect host: HostStateDatum = source_data
      Transaction {
        ..tx,
        outputs: list.map(
          tx.outputs,
          fn(output) {
            if assets.quantity_of(
              output.value,
              old.host_policy,
              #"6962635f686f73745f7374617465",
            ) == 1 {
              expect InlineDatum(next_data) = output.datum
              expect next: HostStateDatum = next_data
              Output {
                ..output,
                datum: InlineDatum(
                  HostStateDatum {
                    ..next,
                    control: HostStateControl {
                      ..next.control,
                      port_registry: host.control.port_registry,
                    },
                  },
                ),
              }
            } else {
              output
            }
          },
        ),
      }
    }
  implementation_registry.implementation_registry.spend(
    Some(old),
    Begin,
    OutputReference {
      transaction_id: #"a738e1301cfeab2ba62f51977af9a7e963b60d166142ac681b8c0e97fd6c69a5",
      output_index: 0,
    },
    tx,
  )
}

// Captured from a real Lucid-built transaction rejected during rehearsal.
// This pair isolates byte-for-byte map preservation from all other guards.
test migration_begin_preserves_port_registry() {
  begin_with_port_order(False)
}

test migration_begin_rejects_reordered_port_registry() fail {
  begin_with_port_order(True)
}
