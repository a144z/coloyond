// Pinned to the MVP execution source; changing this is a versioned protocol change.
export const VAULT_FEEDS = {
  "wsol": {
    "account": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
    "id": "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
  },
  "tbtc": {
    "account": "4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo",
    "id": "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
  },
  "teth": {
    "account": "42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC",
    "id": "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
  }
} as const;
export const VAULT_STATE_DISCRIMINATOR = [228, 196, 82, 165, 98, 210, 235, 152] as const;
