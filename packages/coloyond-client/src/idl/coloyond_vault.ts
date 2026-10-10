/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/coloyond_vault.json`.
 */
export type ColoyondVault = {
  "address": "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6",
  "metadata": {
    "name": "coloyondVault",
    "version": "0.1.0",
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
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "seeder",
          "writable": true,
          "signer": true
        },
        {
          "name": "seederShares",
          "writable": true
        },
        {
          "name": "seederAssetA",
          "writable": true
        },
        {
          "name": "seederAssetB",
          "writable": true
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
          "name": "solUsd"
        },
        {
          "name": "usdcUsd"
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
          "name": "init",
          "type": {
            "defined": {
              "name": "vaultInit"
            }
          }
        }
      ]
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
    }
  ],
  "accounts": [
    {
      "name": "auctionPolicy",
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
      "name": "bountyClaim",
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
      "name": "governanceAccount",
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
      "name": "priceUpdateV2",
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
      "name": "rebalanceIntent",
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
      "name": "vault",
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
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "wrongFeedAccount",
      "msg": "Oracle account is not the pinned feed account"
    },
    {
      "code": 6001,
      "name": "wrongOracleOwner",
      "msg": "Oracle account owner is not the pinned Pyth Receiver program"
    },
    {
      "code": 6002,
      "name": "invalidOraclePolicy",
      "msg": "Oracle policy is unset or outside representable bounds"
    },
    {
      "code": 6003,
      "name": "invalidConfiguredFeedId",
      "msg": "Configured Pyth feed ID is invalid"
    },
    {
      "code": 6004,
      "name": "invalidPythPrice",
      "msg": "Pyth update has the wrong feed, stale data, or is not fully verified"
    },
    {
      "code": 6005,
      "name": "nonPositivePrice",
      "msg": "Price must be positive"
    },
    {
      "code": 6006,
      "name": "futurePublishTime",
      "msg": "Pyth publish time is in the future"
    },
    {
      "code": 6007,
      "name": "confidenceTooWide",
      "msg": "Pyth confidence interval exceeds the configured policy"
    },
    {
      "code": 6008,
      "name": "usdcOutsidePolicy",
      "msg": "USDC/USD is outside the configured depeg policy"
    },
    {
      "code": 6009,
      "name": "precisionLoss",
      "msg": "Price conversion would discard source precision"
    },
    {
      "code": 6010,
      "name": "arithmeticOverflow",
      "msg": "Price conversion overflowed"
    },
    {
      "code": 6011,
      "name": "unsupportedExponent",
      "msg": "Pyth exponent cannot be represented safely"
    }
  ],
  "types": [
    {
      "name": "assetConfig",
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
      "name": "auctionFillRecorded",
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
      "name": "auctionFinished",
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
      "name": "auctionPolicy",
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
      "name": "bountyClaim",
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
      "name": "depositRecorded",
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
      "name": "governanceAccount",
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
                  "name": "policyProposal"
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
      "name": "policyProposal",
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
      "name": "priceFeedMessage",
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
      "name": "priceUpdateV2",
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
                "name": "verificationLevel"
              }
            }
          },
          {
            "name": "priceMessage",
            "type": {
              "defined": {
                "name": "priceFeedMessage"
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
      "name": "rebalanceIntent",
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
      "name": "rebalanceStarted",
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
      "name": "redemptionRecorded",
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
      "name": "riskPauseChanged",
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
      "name": "targetsActivated",
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
      "name": "targetsProposed",
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
      "name": "vault",
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
                    "name": "assetConfig"
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
      "name": "vaultInit",
      "type": {
        "kind": "struct",
        "fields": [
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
            "name": "seedAmounts",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "reserveContributions",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "initialShares",
            "type": "u64"
          },
          {
            "name": "minimumLockedShares",
            "type": "u64"
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
            "name": "maximumNavLossBps",
            "type": "u16"
          },
          {
            "name": "maximumCumulativeNavLossBps",
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
      "name": "vaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "seeder",
            "type": "pubkey"
          },
          {
            "name": "configurationRevision",
            "type": "u64"
          },
          {
            "name": "seedAmounts",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "reserveContributions",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "totalShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "verificationLevel",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "partial",
            "fields": [
              {
                "name": "numSignatures",
                "type": "u8"
              }
            ]
          },
          {
            "name": "full"
          }
        ]
      }
    }
  ]
};
