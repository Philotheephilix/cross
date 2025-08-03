pragma solidity 0.8.23;

import "cross-chain-swap/EscrowFactory.sol";
import "cross-chain-swap/interfaces/IBaseEscrow.sol";
import "cross-chain-swap/libraries/ImmutablesLib.sol";

contract TestEscrowFactory is EscrowFactory {
    using ImmutablesLib for IBaseEscrow.Immutables;

    constructor(
        address limitOrderProtocol,
        IERC20 feeToken,
        IERC20 accessToken,
        address owner, uint32 rescueDelaySrc,
        uint32 rescueDelayDst
    ) EscrowFactory(limitOrderProtocol, feeToken, accessToken, owner, rescueDelayDst, rescueDelayDst) {}

    /**
     * @notice Test function to create source escrow directly (for testing purposes only)
     * @param srcImmutables The immutables for the source escrow
     * @return escrow The address of the deployed escrow contract
     */
    function createSrcEscrow(IBaseEscrow.Immutables calldata srcImmutables) external payable  returns (address escrow) {
        // Validate that the caller sent the required safety deposit
        if (msg.value != srcImmutables.safetyDeposit) {
            revert InsufficientEscrowBalance();
        }

        // Deploy the escrow using the same logic as _postInteraction
        bytes32 salt = srcImmutables.hashMem();
        escrow = _deployEscrow(salt, msg.value, ESCROW_SRC_IMPLEMENTATION);

        // Emit the same event as the standard flow
        emit SrcEscrowCreated(srcImmutables, DstImmutablesComplement({
            maker: srcImmutables.maker,
            amount: srcImmutables.amount,
            token: srcImmutables.token,
            safetyDeposit: srcImmutables.safetyDeposit,
            chainId: 0 // Not used for source escrow
        }));

        return escrow;
    }
}
