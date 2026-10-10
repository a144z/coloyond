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
    }
  ],
  "accounts": [
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
  "events": [
    {
      "name": "depositRecorded",
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
      "name": "redemptionRecorded",
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
      "name": "riskPauseChanged",
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
      "name": "targetsActivated",
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
      "name": "targetsProposed",
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
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidVault",
      "msg": "Vault version or address is invalid"
    },
    {
      "code": 6001,
      "name": "invalidRoles",
      "msg": "Governance and emergency roles must be distinct, nonzero signers"
    },
    {
      "code": 6002,
      "name": "invalidDelay",
      "msg": "Timelock delay must be explicitly configured and nonzero"
    },
    {
      "code": 6003,
      "name": "invalidAssetSet",
      "msg": "Vault asset set is invalid"
    },
    {
      "code": 6004,
      "name": "assetNotAllowed",
      "msg": "Mint is outside the immutable two-asset allowlist"
    },
    {
      "code": 6005,
      "name": "unauthorizedGovernance",
      "msg": "Only governance may propose or resume policy"
    },
    {
      "code": 6006,
      "name": "unauthorizedEmergency",
      "msg": "Only the emergency authority may pause risk"
    },
    {
      "code": 6007,
      "name": "riskPaused",
      "msg": "Risk-increasing operations are paused"
    },
    {
      "code": 6008,
      "name": "proposalPending",
      "msg": "A policy proposal is already pending"
    },
    {
      "code": 6009,
      "name": "staleRevision",
      "msg": "Expected configuration revision is stale"
    },
    {
      "code": 6010,
      "name": "invalidTargets",
      "msg": "Target weights must be positive and total 10000 basis points"
    },
    {
      "code": 6011,
      "name": "timelockActive",
      "msg": "A proposal has not reached its activation slot"
    },
    {
      "code": 6012,
      "name": "noPendingProposal",
      "msg": "No policy proposal is pending"
    },
    {
      "code": 6013,
      "name": "proposalReplay",
      "msg": "Proposal nonce is stale or has already been consumed"
    },
    {
      "code": 6014,
      "name": "arithmeticOverflow",
      "msg": "Governance arithmetic overflow"
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
    }
  ]
};
