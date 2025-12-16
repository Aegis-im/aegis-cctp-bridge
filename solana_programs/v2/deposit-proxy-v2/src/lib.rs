use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{get_associated_token_address, AssociatedToken},
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("XuwZZ9M3dibJAPpz4g4T1rYsiGdfYxcPxPngJaL4XEX");

#[program]
pub mod deposit_proxy_v2 {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_id: [u8; 32],
        destination_domain: u32,
        mint_recipient: Pubkey,
        destination_caller: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            mint_recipient,
            Pubkey::default(),
            DepositProxyV2Error::InvalidMintRecipient
        );

        let vault = &mut ctx.accounts.vault;
        vault.bump = ctx.bumps.vault;
        vault.authority_bump = ctx.bumps.vault_authority;
        vault.vault_id = vault_id;
        vault.admin = ctx.accounts.payer.key();
        vault.transfer_manager = ctx.accounts.payer.key();
        vault.burn_token_mint = ctx.accounts.burn_token_mint.key();
        vault.destination_domain = destination_domain;
        vault.mint_recipient = mint_recipient;
        vault.destination_caller = destination_caller;
        vault.allowed_token_messenger_minter_program =
            ctx.accounts.token_messenger_minter_program.key();
        vault.allowed_message_transmitter_program = ctx.accounts.message_transmitter_program.key();
        Ok(())
    }

    pub fn burn_for_deposit(
        ctx: Context<BurnForDeposit>,
        amount: u64,
        max_fee: u64,
        min_finality_threshold: u32,
    ) -> Result<()> {
        burn_for_deposit_impl(ctx, amount, max_fee, min_finality_threshold)
    }

    pub fn set_admin(ctx: Context<SetAdmin>, new_admin: Pubkey) -> Result<()> {
        require_keys_neq!(new_admin, Pubkey::default(), DepositProxyV2Error::InvalidAdmin);
        ctx.accounts.vault.admin = new_admin;
        Ok(())
    }

    pub fn set_transfer_manager(
        ctx: Context<SetTransferManager>,
        new_transfer_manager: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            new_transfer_manager,
            Pubkey::default(),
            DepositProxyV2Error::InvalidTransferManager
        );
        ctx.accounts.vault.transfer_manager = new_transfer_manager;
        Ok(())
    }

    pub fn set_allowed_token_messenger_minter_program(
        ctx: Context<SetAllowedPrograms>,
        program_id: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            program_id,
            Pubkey::default(),
            DepositProxyV2Error::InvalidProgramId
        );
        ctx.accounts.vault.allowed_token_messenger_minter_program = program_id;
        Ok(())
    }

    pub fn set_allowed_message_transmitter_program(
        ctx: Context<SetAllowedPrograms>,
        program_id: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            program_id,
            Pubkey::default(),
            DepositProxyV2Error::InvalidProgramId
        );
        ctx.accounts.vault.allowed_message_transmitter_program = program_id;
        Ok(())
    }

    pub fn set_destination(
        ctx: Context<SetDestination>,
        destination_domain: u32,
        mint_recipient: Pubkey,
        destination_caller: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            mint_recipient,
            Pubkey::default(),
            DepositProxyV2Error::InvalidMintRecipient
        );
        ctx.accounts.vault.destination_domain = destination_domain;
        ctx.accounts.vault.mint_recipient = mint_recipient;
        ctx.accounts.vault.destination_caller = destination_caller;
        Ok(())
    }

    pub fn rescue_transfer(ctx: Context<RescueTransfer>, amount: u64) -> Result<()> {
        require_gt!(amount, 0, DepositProxyV2Error::InvalidAmount);

        require_keys_eq!(
            ctx.accounts.vault.burn_token_mint,
            ctx.accounts.burn_token_mint.key(),
            DepositProxyV2Error::InvalidBurnMint
        );
        require_keys_eq!(
            ctx.accounts.destination_token_account.mint,
            ctx.accounts.burn_token_mint.key(),
            DepositProxyV2Error::InvalidDestinationTokenAccount
        );

        let vault_key = ctx.accounts.vault.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            vault_key.as_ref(),
            &[ctx.accounts.vault.authority_bump],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.destination_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }
}

fn burn_for_deposit_impl(
    ctx: Context<BurnForDeposit>,
    amount: u64,
    max_fee: u64,
    min_finality_threshold: u32,
) -> Result<()> {
    require_gt!(amount, 0, DepositProxyV2Error::InvalidAmount);

    require_keys_eq!(
        ctx.accounts.transfer_manager.key(),
        ctx.accounts.vault.transfer_manager,
        DepositProxyV2Error::Unauthorized
    );

    require_keys_eq!(
        ctx.accounts.vault.allowed_token_messenger_minter_program,
        ctx.accounts.token_messenger_minter_program.key(),
        DepositProxyV2Error::InvalidProgramId
    );
    require_keys_eq!(
        ctx.accounts.vault.allowed_message_transmitter_program,
        ctx.accounts.message_transmitter_program.key(),
        DepositProxyV2Error::InvalidProgramId
    );

    require_keys_eq!(
        ctx.accounts.vault.burn_token_mint,
        ctx.accounts.burn_token_mint.key(),
        DepositProxyV2Error::InvalidBurnMint
    );

    let expected_ata =
        get_associated_token_address(&ctx.accounts.vault_authority.key(), &ctx.accounts.burn_token_mint.key());
    require_keys_eq!(
        expected_ata,
        ctx.accounts.vault_token_account.key(),
        DepositProxyV2Error::InvalidVaultTokenAccount
    );
    require_keys_eq!(
        ctx.accounts.vault_token_account.owner,
        ctx.accounts.vault_authority.key(),
        DepositProxyV2Error::InvalidVaultTokenAccountOwner
    );

    let cpi_program = ctx
        .accounts
        .token_messenger_minter_program
        .to_account_info();

    let cpi_accounts = token_messenger_minter_v2::cpi::accounts::DepositForBurnContext {
        owner: ctx.accounts.vault_authority.to_account_info(),
        event_rent_payer: ctx.accounts.event_rent_payer.to_account_info(),
        sender_authority_pda: ctx.accounts.sender_authority_pda.to_account_info(),
        burn_token_account: ctx.accounts.vault_token_account.to_account_info(),
        denylist_account: ctx.accounts.denylist_account.to_account_info(),
        message_transmitter: ctx.accounts.message_transmitter.to_account_info(),
        token_messenger: ctx.accounts.token_messenger.to_account_info(),
        remote_token_messenger: ctx.accounts.remote_token_messenger.to_account_info(),
        token_minter: ctx.accounts.token_minter.to_account_info(),
        local_token: ctx.accounts.local_token.to_account_info(),
        burn_token_mint: ctx.accounts.burn_token_mint.to_account_info(),
        message_sent_event_data: ctx.accounts.message_sent_event_data.to_account_info(),
        message_transmitter_program: ctx.accounts.message_transmitter_program.to_account_info(),
        token_messenger_minter_program: ctx.accounts.token_messenger_minter_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        program: ctx.accounts.token_messenger_minter_program.to_account_info(),
    };

    let vault_key = ctx.accounts.vault.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault_authority",
        vault_key.as_ref(),
        &[ctx.accounts.vault.authority_bump],
    ]];

    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

    let params = token_messenger_minter_v2::token_messenger_v2::instructions::DepositForBurnParams {
        amount,
        destination_domain: ctx.accounts.vault.destination_domain,
        mint_recipient: ctx.accounts.vault.mint_recipient,
        destination_caller: ctx.accounts.vault.destination_caller,
        max_fee,
        min_finality_threshold,
    };

    token_messenger_minter_v2::cpi::deposit_for_burn(cpi_ctx, params)
}

#[derive(Accounts)]
#[instruction(vault_id: [u8; 32])]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Vault::LEN,
        seeds = [b"vault", vault_id.as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA signing authority for CPI.
    #[account(
        seeds = [b"vault_authority", vault.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub burn_token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = burn_token_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub message_transmitter_program:
        Program<'info, message_transmitter_v2::program::MessageTransmitterV2>,

    pub token_messenger_minter_program:
        Program<'info, token_messenger_minter_v2::program::TokenMessengerMinterV2>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnForDeposit<'info> {
    pub transfer_manager: Signer<'info>,

    #[account(mut)]
    pub event_rent_payer: Signer<'info>,

    #[account(seeds = [b"vault", vault.vault_id.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(seeds = [b"vault_authority", vault.key().as_ref()], bump = vault.authority_bump)]
    /// CHECK: PDA signing authority for CPI.
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: empty PDA from TokenMessengerMinterV2.
    pub sender_authority_pda: UncheckedAccount<'info>,

    /// CHECK: denylist PDA from TokenMessengerMinterV2.
    #[account(
        seeds = [b"denylist_account", vault_authority.key().as_ref()],
        bump,
        seeds::program = token_messenger_minter_program
    )]
    pub denylist_account: UncheckedAccount<'info>,

    pub token_messenger: Account<'info, token_messenger_minter_v2::token_messenger_v2::state::TokenMessenger>,

    pub remote_token_messenger:
        Account<'info, token_messenger_minter_v2::token_messenger_v2::state::RemoteTokenMessenger>,

    pub token_minter: Account<'info, token_messenger_minter_v2::token_minter_v2::state::TokenMinter>,

    #[account(mut)]
    pub local_token: Account<'info, token_messenger_minter_v2::token_minter_v2::state::LocalToken>,

    #[account(mut)]
    pub burn_token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub message_transmitter: Account<'info, message_transmitter_v2::state::MessageTransmitter>,

    /// CHECK: non-PDA uninitialized signer for MessageSent event data.
    #[account(mut)]
    pub message_sent_event_data: Signer<'info>,

    pub message_transmitter_program:
        Program<'info, message_transmitter_v2::program::MessageTransmitterV2>,

    pub token_messenger_minter_program:
        Program<'info, token_messenger_minter_v2::program::TokenMessengerMinterV2>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// CHECK: Anchor event-cpi authority PDA for TokenMessengerMinterV2.
    #[account(
        seeds = [b"__event_authority"],
        bump,
        seeds::program = token_messenger_minter_program
    )]
    pub event_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.vault_id.as_ref()],
        bump = vault.bump,
        constraint = vault.admin == admin.key() @ DepositProxyV2Error::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct SetTransferManager<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.vault_id.as_ref()],
        bump = vault.bump,
        constraint = vault.admin == admin.key() @ DepositProxyV2Error::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct SetAllowedPrograms<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.vault_id.as_ref()],
        bump = vault.bump,
        constraint = vault.admin == admin.key() @ DepositProxyV2Error::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct SetDestination<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.vault_id.as_ref()],
        bump = vault.bump,
        constraint = vault.admin == admin.key() @ DepositProxyV2Error::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct RescueTransfer<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"vault", vault.vault_id.as_ref()],
        bump = vault.bump,
        constraint = vault.admin == admin.key() @ DepositProxyV2Error::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    #[account(seeds = [b"vault_authority", vault.key().as_ref()], bump = vault.authority_bump)]
    /// CHECK: PDA signing authority for SPL transfer.
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub burn_token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub bump: u8,
    pub authority_bump: u8,
    pub vault_id: [u8; 32],
    pub admin: Pubkey,
    pub transfer_manager: Pubkey,
    pub burn_token_mint: Pubkey,
    pub destination_domain: u32,
    pub mint_recipient: Pubkey,
    pub destination_caller: Pubkey,
    pub allowed_token_messenger_minter_program: Pubkey,
    pub allowed_message_transmitter_program: Pubkey,
}

impl Vault {
    pub const LEN: usize = 8 + 1 + 1 + 32 + 32 + 32 + 32 + 4 + 32 + 32 + 32 + 32;
}

#[error_code]
pub enum DepositProxyV2Error {
    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid burn mint")]
    InvalidBurnMint,

    #[msg("Invalid admin")]
    InvalidAdmin,

    #[msg("Invalid transfer manager")]
    InvalidTransferManager,

    #[msg("Invalid program id")]
    InvalidProgramId,

    #[msg("Invalid mint recipient")]
    InvalidMintRecipient,

    #[msg("Invalid vault token account")]
    InvalidVaultTokenAccount,

    #[msg("Invalid vault token account owner")]
    InvalidVaultTokenAccountOwner,

    #[msg("Invalid destination token account")]
    InvalidDestinationTokenAccount,
}
