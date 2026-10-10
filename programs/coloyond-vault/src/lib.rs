use anchor_lang::prelude::*;

pub mod accounting;
pub mod instructions;
pub mod state;

declare_id!("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");

#[program]
pub mod coloyond_vault {
    use super::*;

    /// Bootstrap placeholder. Financial instructions are added only against the reviewed S0F contract.
    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        err!(VaultError::NotImplemented)
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[error_code]
pub enum VaultError {
    #[msg("Instruction is not implemented in this bootstrap revision")]
    NotImplemented,
}
