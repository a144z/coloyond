use coloyond_etf_math::quote_exact_in;
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

const CASE_LEN: usize = 43;

fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or(ProgramError::InvalidInstructionData)?;
    Ok(u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ))
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16, ProgramError> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or(ProgramError::InvalidInstructionData)?;
    Ok(u16::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ))
}

fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() != CASE_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let asset_count = usize::from(data[0]);
    if !(2..=3).contains(&asset_count) {
        return Err(ProgramError::InvalidInstructionData);
    }

    let balances = [read_u64(data, 1)?, read_u64(data, 9)?, read_u64(data, 17)?];
    let weights = [read_u16(data, 25)?, read_u16(data, 27)?, read_u16(data, 29)?];
    let asset_in = usize::from(data[31]);
    let asset_out = usize::from(data[32]);
    let amount_in = read_u64(data, 33)?;
    let fee_bps = read_u16(data, 41)?;
    let quote = quote_exact_in(
        &balances[..asset_count],
        &weights[..asset_count],
        asset_in,
        asset_out,
        amount_in,
        fee_bps,
    )
    .map_err(|_| ProgramError::InvalidInstructionData)?;

    msg!(
        "q96 assets={} amount_out={} fee={}",
        asset_count,
        quote.amount_out,
        quote.fee_amount
    );
    Ok(())
}
