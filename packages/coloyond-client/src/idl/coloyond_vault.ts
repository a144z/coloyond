/**
 * Program IDL in camelCase format for use in JavaScript and TypeScript.
 * The authoritative JSON IDL is `idl/coloyond_vault.json`.
 */
export type ColoyondVault = {
  "address": "",
  "metadata": {
    "name": "coloyondVault",
    "version": "0.2.0",
    "spec": "0.1.0",
    "description": "Coloyond pooled two-asset vault program"
  },
  "instructions": [
    {
      "name": "activateTargets",
      "discriminator": [
        181,
        9,
        93,
        20,
        130,
        145,
        243,
        226
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "depositProportional",
      "discriminator": [
        63,
        57,
        128,
        46,
        164,
        238,
        143,
        133
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "userShares",
          "writable": true
        },
        {
          "name": "depositor",
          "signer": true
        },
        {
          "name": "custodyA",
          "writable": true
        },
        {
          "name": "custodyB",
          "writable": true
        },
        {
          "name": "userAssetA",
          "writable": true
        },
        {
          "name": "userAssetB",
          "writable": true
        },
        {
          "name": "mintA"
        },
        {
          "name": "mintB"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "maxAmounts",
          "type": {
            "array": [
              "u64",
              2
            ]
          }
        },
        {
          "name": "minSharesOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fillAuction",
      "discriminator": [
        51,
        225,
        89,
        197,
        65,
        5,
        178,
        250
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "auctionPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "rebalanceIntent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101,
                  95,
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "bountyClaim",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "expected_intent_sequence"
              }
            ]
          }
        },
        {
          "name": "custodyA",
          "writable": true
        },
        {
          "name": "custodyB",
          "writable": true
        },
        {
          "name": "mintA"
        },
        {
          "name": "mintB"
        },
        {
          "name": "solUsd",
          "address": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
        },
        {
          "name": "usdcUsd",
          "address": "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
        },
        {
          "name": "takerIn",
          "writable": true
        },
        {
          "name": "takerOut",
          "writable": true
        },
        {
          "name": "taker",
          "signer": true
        },
        {
          "name": "executor",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "expectedIntentSequence",
          "type": "u64"
        },
        {
          "name": "sellAmount",
          "type": "u64"
        },
        {
          "name": "grossBuyAmount",
          "type": "u64"
        },
        {
          "name": "bountyAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finishOrExpire",
      "discriminator": [
        87,
        244,
        172,
        88,
        190,
        34,
        32,
        33
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "auctionPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "rebalanceIntent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101,
                  95,
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "custodyA",
          "writable": true
        },
        {
          "name": "custodyB",
          "writable": true
        },
        {
          "name": "mintA"
        },
        {
          "name": "mintB"
        },
        {
          "name": "solUsd",
          "address": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
        },
        {
          "name": "usdcUsd",
          "address": "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "expectedIntentSequence",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeVault",
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [],
      "args": []
    },
    {
      "name": "pauseRisk",
      "discriminator": [
        221,
        2,
        34,
        100,
        217,
        178,
        42,
        15
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "emergencyAuthority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "proposeTargets",
      "discriminator": [
        173,
        80,
        241,
        209,
        171,
        165,
        93,
        64
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "governanceAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "expectedRevision",
          "type": "u64"
        },
        {
          "name": "proposedTargetBps",
          "type": {
            "array": [
              "u16",
              2
            ]
          }
        }
      ]
    },
    {
      "name": "redeemInKind",
      "discriminator": [
        102,
        58,
        189,
        252,
        192,
        219,
        140,
        89
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "userShares",
          "writable": true
        },
        {
          "name": "holder",
          "signer": true
        },
        {
          "name": "custodyA",
          "writable": true
        },
        {
          "name": "custodyB",
          "writable": true
        },
        {
          "name": "userAssetA",
          "writable": true
        },
        {
          "name": "userAssetB",
          "writable": true
        },
        {
          "name": "mintA"
        },
        {
          "name": "mintB"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "sharesToBurn",
          "type": "u64"
        },
        {
          "name": "minAmountsOut",
          "type": {
            "array": [
              "u64",
              2
            ]
          }
        }
      ]
    },
    {
      "name": "resumeRisk",
      "discriminator": [
        207,
        89,
        77,
        209,
        47,
        207,
        14,
        13
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "governanceAuthority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "startRebalance",
      "discriminator": [
        61,
        251,
        146,
        164,
        48,
        29,
        208,
        170
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "auctionPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "rebalanceIntent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101,
                  95,
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "custodyA",
          "writable": true
        },
        {
          "name": "custodyB",
          "writable": true
        },
        {
          "name": "mintA"
        },
        {
          "name": "mintB"
        },
        {
          "name": "solUsd",
          "address": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
        },
        {
          "name": "usdcUsd",
          "address": "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sellAsset",
          "type": "u8"
        },
        {
          "name": "initialSellAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "proposeConditionRule",
      "discriminator": [
        13,
        142,
        236,
        248,
        39,
        221,
        91,
        0
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "auctionPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "conditionState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  100,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "governanceAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "ConditionRuleConfig"
            }
          }
        },
        {
          "name": "bounds",
          "type": {
            "defined": {
              "name": "ConditionBounds"
            }
          }
        }
      ]
    },
    {
      "name": "executeConditionRule",
      "discriminator": [
        124,
        64,
        222,
        89,
        235,
        142,
        235,
        25
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "auctionPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "conditionState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  100,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "observeCondition",
      "discriminator": [
        143,
        40,
        41,
        56,
        32,
        29,
        60,
        138
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "auctionPolicy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "conditionState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  100,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "solUsd",
          "address": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
        },
        {
          "name": "usdcUsd",
          "address": "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
        }
      ],
      "args": []
    },
    {
      "name": "activateCondition",
      "discriminator": [
        80,
        90,
        43,
        159,
        104,
        36,
        106,
        252
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "governance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  111,
                  118,
                  101,
                  114,
                  110,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "auctionPolicy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "conditionState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  100,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "rebalanceIntent",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101,
                  95,
                  105,
                  110,
                  116,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "solUsd",
          "address": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
        },
        {
          "name": "usdcUsd",
          "address": "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
        }
      ],
      "args": [
        {
          "name": "expectedNonce",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "AuctionPolicy",
      "discriminator": [
        2,
        104,
        14,
        217,
        253,
        100,
        255,
        33
      ]
    },
    {
      "name": "BountyClaim",
      "discriminator": [
        130,
        113,
        6,
        57,
        79,
        54,
        78,
        205
      ]
    },
    {
      "name": "GovernanceAccount",
      "discriminator": [
        145,
        56,
        248,
        48,
        121,
        81,
        15,
        22
      ]
    },
    {
      "name": "PriceUpdateV2",
      "discriminator": [
        34,
        241,
        35,
        99,
        157,
        126,
        244,
        205
      ]
    },
    {
      "name": "RebalanceIntent",
      "discriminator": [
        38,
        161,
        149,
        244,
        144,
        119,
        200,
        124
      ]
    },
    {
      "name": "Vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    },
    {
      "name": "ConditionState",
      "discriminator": [
        27,
        241,
        242,
        99,
        254,
        50,
        207,
        153
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "WrongFeedAccount",
      "msg": "Oracle account is not the pinned feed account"
    },
    {
      "code": 6001,
      "name": "WrongOracleOwner",
      "msg": "Oracle account owner is not the pinned Pyth Receiver program"
    },
    {
      "code": 6002,
      "name": "InvalidOraclePolicy",
      "msg": "Oracle policy is unset or outside representable bounds"
    },
    {
      "code": 6003,
      "name": "InvalidConfiguredFeedId",
      "msg": "Configured Pyth feed ID is invalid"
    },
    {
      "code": 6004,
      "name": "InvalidPythPrice",
      "msg": "Pyth update has the wrong feed, stale data, or is not fully verified"
    },
    {
      "code": 6005,
      "name": "NonPositivePrice",
      "msg": "Price must be positive"
    },
    {
      "code": 6006,
      "name": "FuturePublishTime",
      "msg": "Pyth publish time is in the future"
    },
    {
      "code": 6007,
      "name": "ConfidenceTooWide",
      "msg": "Pyth confidence interval exceeds the configured policy"
    },
    {
      "code": 6008,
      "name": "UsdcOutsidePolicy",
      "msg": "USDC/USD is outside the configured depeg policy"
    },
    {
      "code": 6009,
      "name": "PrecisionLoss",
      "msg": "Price conversion would discard source precision"
    },
    {
      "code": 6010,
      "name": "ArithmeticOverflow",
      "msg": "Price conversion overflowed"
    },
    {
      "code": 6011,
      "name": "UnsupportedExponent",
      "msg": "Pyth exponent cannot be represented safely"
    },
    {
      "code": 7000,
      "name": "InvalidBounds",
      "msg": "Condition bounds are unset or invalid"
    },
    {
      "code": 7001,
      "name": "InvalidRule",
      "msg": "Conditional rule is malformed"
    },
    {
      "code": 7002,
      "name": "RuleDisabled",
      "msg": "Conditional rule is disabled"
    },
    {
      "code": 7003,
      "name": "RuleExpired",
      "msg": "Conditional rule has expired"
    },
    {
      "code": 7004,
      "name": "StaleTargetRevision",
      "msg": "Conditional rule target revision is stale"
    },
    {
      "code": 7005,
      "name": "StaleConfigurationRevision",
      "msg": "Conditional rule configuration revision is stale"
    },
    {
      "code": 7006,
      "name": "InvalidObservation",
      "msg": "Condition observation is invalid"
    },
    {
      "code": 7007,
      "name": "ConditionFuturePublishTime",
      "msg": "Condition observation publish time is future or before rule creation"
    },
    {
      "code": 7008,
      "name": "StaleObservation",
      "msg": "Condition observation is stale"
    },
    {
      "code": 7009,
      "name": "OracleReplay",
      "msg": "Condition observation replays an earlier Pyth publish time"
    },
    {
      "code": 7010,
      "name": "ObservationTooClose",
      "msg": "Condition observations do not satisfy the configured separation"
    },
    {
      "code": 7011,
      "name": "WrongObservationAsset",
      "msg": "Condition observation is for the wrong asset"
    },
    {
      "code": 7012,
      "name": "InvalidPredicate",
      "msg": "Conditional predicate is invalid"
    },
    {
      "code": 7013,
      "name": "NotTriggered",
      "msg": "Conditional predicate is not currently triggered"
    },
    {
      "code": 7014,
      "name": "NonceMismatch",
      "msg": "Conditional rule nonce is stale or already consumed"
    },
    {
      "code": 7015,
      "name": "ConditionArithmeticOverflow",
      "msg": "Condition arithmetic overflowed"
    },
    {
      "code": 7016,
      "name": "InvalidState",
      "msg": "Condition state account version or vault binding is invalid"
    },
    {
      "code": 7017,
      "name": "PolicyUnavailable",
      "msg": "No active condition policy exists"
    },
    {
      "code": 7018,
      "name": "ProposalPending",
      "msg": "A non-stale condition proposal is already pending"
    },
    {
      "code": 7019,
      "name": "ActiveRule",
      "msg": "A live condition rule is already active"
    },
    {
      "code": 7020,
      "name": "TimelockActive",
      "msg": "Condition proposal has not reached its timelock slot"
    },
    {
      "code": 7021,
      "name": "ActiveAuction",
      "msg": "An active rebalance intent prevents condition activation"
    },
    {
      "code": 7022,
      "name": "OracleAgePolicyMismatch",
      "msg": "Condition observation age exceeds the approved oracle policy"
    }
  ],
  "types": [
    {
      "name": "AssetConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "custody",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "targetBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "AuctionFillRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "intentSequence",
            "type": "u64"
          },
          {
            "name": "previousIntentSequence",
            "type": "u64"
          },
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "sellAsset",
            "type": "u8"
          },
          {
            "name": "sellAmount",
            "type": "u64"
          },
          {
            "name": "grossBuyAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "bountyAmount",
            "type": "u64"
          },
          {
            "name": "cumulativeNavLossQ9",
            "type": "u128"
          },
          {
            "name": "remainingSellAmount",
            "type": "u64"
          },
          {
            "name": "bountyClaim",
            "type": "pubkey"
          },
          {
            "name": "publishTimes",
            "type": {
              "array": [
                "i64",
                2
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "AuctionFinished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "intentSequence",
            "type": "u64"
          },
          {
            "name": "remainingSellAmount",
            "type": "u64"
          },
          {
            "name": "expired",
            "type": "bool"
          },
          {
            "name": "completed",
            "type": "bool"
          },
          {
            "name": "staleConfiguration",
            "type": "bool"
          },
          {
            "name": "publishTimes",
            "type": {
              "array": [
                "i64",
                2
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "AuctionPolicy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "configurationRevision",
            "type": "u64"
          },
          {
            "name": "maximumAgeSeconds",
            "type": "u64"
          },
          {
            "name": "maximumConfidenceBps",
            "type": "u16"
          },
          {
            "name": "maximumUsdcDeviationBps",
            "type": "u16"
          },
          {
            "name": "minimumDriftBps",
            "type": "u16"
          },
          {
            "name": "maximumTradeValueQ9",
            "type": "u64"
          },
          {
            "name": "cooldownSlots",
            "type": "u64"
          },
          {
            "name": "lastCompletedSlot",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "curveStartRateBps",
            "type": "u16"
          },
          {
            "name": "curveEndRateBps",
            "type": "u16"
          },
          {
            "name": "durationSlots",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "maximumFeeBps",
            "type": "u16"
          },
          {
            "name": "maximumBountyPerFill",
            "type": "u64"
          },
          {
            "name": "maximumCumulativeNavLossBps",
            "type": "u16"
          },
          {
            "name": "maximumNavLossBps",
            "type": "u16"
          },
          {
            "name": "assetFeedIndices",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "BountyClaim",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "assetIndex",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "DepositRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountsIn",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "sharesOut",
            "type": "u64"
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "GovernanceAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "type": "pubkey"
          },
          {
            "name": "allowedMints",
            "type": {
              "array": [
                "pubkey",
                2
              ]
            }
          },
          {
            "name": "governanceAuthority",
            "type": "pubkey"
          },
          {
            "name": "emergencyAuthority",
            "type": "pubkey"
          },
          {
            "name": "minDelaySlots",
            "type": "u64"
          },
          {
            "name": "configurationRevision",
            "type": "u64"
          },
          {
            "name": "targetBps",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          },
          {
            "name": "proposalNonce",
            "type": "u64"
          },
          {
            "name": "pending",
            "type": {
              "option": {
                "defined": {
                  "name": "PolicyProposal"
                }
              }
            }
          },
          {
            "name": "riskPaused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "PolicyProposal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "expectedRevision",
            "type": "u64"
          },
          {
            "name": "proposedTargetBps",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          },
          {
            "name": "proposedAtSlot",
            "type": "u64"
          },
          {
            "name": "activateAfterSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PriceFeedMessage",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "exponent",
            "type": "i32"
          },
          {
            "name": "publishTime",
            "type": "i64"
          },
          {
            "name": "prevPublishTime",
            "type": "i64"
          },
          {
            "name": "emaPrice",
            "type": "i64"
          },
          {
            "name": "emaConf",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PriceUpdateV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "writeAuthority",
            "type": "pubkey"
          },
          {
            "name": "verificationLevel",
            "type": {
              "defined": {
                "name": "VerificationLevel"
              }
            }
          },
          {
            "name": "priceMessage",
            "type": {
              "defined": {
                "name": "PriceFeedMessage"
              }
            }
          },
          {
            "name": "postedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RebalanceIntent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "targetRevision",
            "type": "u64"
          },
          {
            "name": "policyRevision",
            "type": "u64"
          },
          {
            "name": "sellAsset",
            "type": "u8"
          },
          {
            "name": "initialSellAmount",
            "type": "u64"
          },
          {
            "name": "remainingSellAmount",
            "type": "u64"
          },
          {
            "name": "startSlot",
            "type": "u64"
          },
          {
            "name": "endSlot",
            "type": "u64"
          },
          {
            "name": "startPublishTimes",
            "type": {
              "array": [
                "i64",
                2
              ]
            }
          },
          {
            "name": "lastPublishTimes",
            "type": {
              "array": [
                "i64",
                2
              ]
            }
          },
          {
            "name": "startPricesQ9",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "startNavQ9",
            "type": "u128"
          },
          {
            "name": "cumulativeNavLossQ9",
            "type": "u128"
          },
          {
            "name": "curveStartRateBps",
            "type": "u16"
          },
          {
            "name": "curveEndRateBps",
            "type": "u16"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "maximumFeeBps",
            "type": "u16"
          },
          {
            "name": "maximumBountyPerFill",
            "type": "u64"
          },
          {
            "name": "maximumCumulativeNavLossBps",
            "type": "u16"
          },
          {
            "name": "maximumNavLossBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "RebalanceStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "targetRevision",
            "type": "u64"
          },
          {
            "name": "sellAsset",
            "type": "u8"
          },
          {
            "name": "initialSellAmount",
            "type": "u64"
          },
          {
            "name": "startSlot",
            "type": "u64"
          },
          {
            "name": "endSlot",
            "type": "u64"
          },
          {
            "name": "pricesQ9",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "publishTimes",
            "type": {
              "array": [
                "i64",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "RedemptionRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "amountsOut",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RiskPauseChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "TargetsActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "targetBps",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "TargetsProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "expectedRevision",
            "type": "u64"
          },
          {
            "name": "targetBps",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "Vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "configurationRevision",
            "type": "u64"
          },
          {
            "name": "assets",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "AssetConfig"
                  }
                },
                2
              ]
            }
          },
          {
            "name": "shareMint",
            "type": "pubkey"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "minimumLockedShares",
            "type": "u64"
          },
          {
            "name": "accountedAmounts",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "bootstrapReserve",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "bountyLiabilities",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "VerificationLevel",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Partial",
            "fields": [
              {
                "name": "numSignatures",
                "type": "u8"
              }
            ]
          },
          {
            "name": "Full"
          }
        ]
      }
    },
    {
      "name": "ConditionBounds",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maximumObservationAgeSeconds",
            "type": "u64"
          },
          {
            "name": "minimumObservationSeparationSeconds",
            "type": "u64"
          },
          {
            "name": "minimumObservationSeparationSlots",
            "type": "u64"
          },
          {
            "name": "maximumRuleLifetimeSeconds",
            "type": "u64"
          },
          {
            "name": "maximumRuleLifetimeSlots",
            "type": "u64"
          },
          {
            "name": "maximumScheduleDelaySeconds",
            "type": "u64"
          },
          {
            "name": "maximumScheduleDelaySlots",
            "type": "u64"
          },
          {
            "name": "maximumHysteresisBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ConditionObservation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetIndex",
            "type": "u8"
          },
          {
            "name": "priceQ18",
            "type": "u128"
          },
          {
            "name": "publishTime",
            "type": "i64"
          },
          {
            "name": "observedAt",
            "type": "i64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConditionRevisions",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "target",
            "type": "u64"
          },
          {
            "name": "configuration",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CrossingDirection",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Above"
          },
          {
            "name": "Below"
          }
        ]
      }
    },
    {
      "name": "ConditionPredicate",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Schedule",
            "fields": [
              {
                "name": "assetIndex",
                "type": "u8"
              },
              {
                "name": "notBeforeUnixTimestamp",
                "type": "i64"
              },
              {
                "name": "notBeforeSlot",
                "type": "u64"
              }
            ]
          },
          {
            "name": "PriceCross",
            "fields": [
              {
                "name": "assetIndex",
                "type": "u8"
              },
              {
                "name": "direction",
                "type": {
                  "defined": {
                    "name": "CrossingDirection"
                  }
                }
              },
              {
                "name": "thresholdQ18",
                "type": "u128"
              },
              {
                "name": "hysteresisBps",
                "type": "u16"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "ConditionalRule",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "expectedRevisions",
            "type": {
              "defined": {
                "name": "ConditionRevisions"
              }
            }
          },
          {
            "name": "authorizedTargetRevision",
            "type": "u64"
          },
          {
            "name": "targetBps",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "expiresSlot",
            "type": "u64"
          },
          {
            "name": "predicate",
            "type": {
              "defined": {
                "name": "ConditionPredicate"
              }
            }
          },
          {
            "name": "lastObservation",
            "type": {
              "option": {
                "defined": {
                  "name": "ConditionObservation"
                }
              }
            }
          },
          {
            "name": "pendingActivation",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "ConditionRuleConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "targetBps",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "expiresSlot",
            "type": "u64"
          },
          {
            "name": "predicate",
            "type": {
              "defined": {
                "name": "ConditionPredicate"
              }
            }
          }
        ]
      }
    },
    {
      "name": "PendingConditionRule",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rule",
            "type": {
              "defined": {
                "name": "ConditionalRule"
              }
            }
          },
          {
            "name": "bounds",
            "type": {
              "defined": {
                "name": "ConditionBounds"
              }
            }
          },
          {
            "name": "activateAfterSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConditionState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "nextNonce",
            "type": "u64"
          },
          {
            "name": "activeRule",
            "type": {
              "option": {
                "defined": {
                  "name": "ConditionalRule"
                }
              }
            }
          },
          {
            "name": "activeBounds",
            "type": {
              "option": {
                "defined": {
                  "name": "ConditionBounds"
                }
              }
            }
          },
          {
            "name": "pending",
            "type": {
              "option": {
                "defined": {
                  "name": "PendingConditionRule"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "ConditionRuleProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "rule",
            "type": {
              "defined": {
                "name": "ConditionalRule"
              }
            }
          },
          {
            "name": "bounds",
            "type": {
              "defined": {
                "name": "ConditionBounds"
              }
            }
          },
          {
            "name": "activateAfterSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConditionRuleActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "ruleNonce",
            "type": "u64"
          },
          {
            "name": "expectedTargetRevision",
            "type": "u64"
          },
          {
            "name": "configurationRevision",
            "type": "u64"
          },
          {
            "name": "activateAfterSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConditionObserved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "ruleNonce",
            "type": "u64"
          },
          {
            "name": "assetIndex",
            "type": "u8"
          },
          {
            "name": "priceQ18",
            "type": "u128"
          },
          {
            "name": "publishTime",
            "type": "i64"
          },
          {
            "name": "status",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ConditionActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "consumedNonce",
            "type": "u64"
          },
          {
            "name": "targetRevision",
            "type": "u64"
          },
          {
            "name": "configurationRevision",
            "type": "u64"
          },
          {
            "name": "targetBps",
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "AuctionFillRecorded",
      "discriminator": [
        203,
        102,
        150,
        119,
        175,
        40,
        111,
        133
      ]
    },
    {
      "name": "AuctionFinished",
      "discriminator": [
        65,
        27,
        187,
        231,
        76,
        80,
        59,
        60
      ]
    },
    {
      "name": "ConditionActivated",
      "discriminator": [
        201,
        214,
        37,
        15,
        186,
        68,
        30,
        58
      ]
    },
    {
      "name": "ConditionObserved",
      "discriminator": [
        115,
        91,
        200,
        169,
        170,
        25,
        59,
        238
      ]
    },
    {
      "name": "ConditionRuleActivated",
      "discriminator": [
        234,
        236,
        199,
        169,
        188,
        77,
        55,
        246
      ]
    },
    {
      "name": "ConditionRuleProposed",
      "discriminator": [
        224,
        0,
        174,
        150,
        193,
        229,
        179,
        101
      ]
    },
    {
      "name": "DepositRecorded",
      "discriminator": [
        0,
        223,
        90,
        235,
        183,
        248,
        79,
        67
      ]
    },
    {
      "name": "RebalanceStarted",
      "discriminator": [
        187,
        27,
        107,
        253,
        228,
        48,
        27,
        157
      ]
    },
    {
      "name": "RedemptionRecorded",
      "discriminator": [
        249,
        2,
        221,
        44,
        24,
        250,
        99,
        43
      ]
    },
    {
      "name": "RiskPauseChanged",
      "discriminator": [
        187,
        81,
        218,
        209,
        143,
        122,
        187,
        36
      ]
    },
    {
      "name": "TargetsActivated",
      "discriminator": [
        60,
        214,
        221,
        19,
        123,
        190,
        202,
        77
      ]
    },
    {
      "name": "TargetsProposed",
      "discriminator": [
        156,
        177,
        52,
        11,
        233,
        173,
        58,
        116
      ]
    }
  ]
};
