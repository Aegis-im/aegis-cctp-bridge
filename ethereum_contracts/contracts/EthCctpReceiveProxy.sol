// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IMessageTransmitter {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

contract EthCctpReceiveProxy {
    address public admin;
    address public manager;
    address public transferTo;

    error NotAdmin();
    error NotManagerOrAdmin();
    error ZeroAddress();
    error ReceiveMessageFailed();
    error TokenTransferFailed();

    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event ManagerUpdated(address indexed oldManager, address indexed newManager);
    event TransferToUpdated(address indexed oldTransferTo, address indexed newTransferTo);
    event MessageReceivedAndForwarded(
        address indexed caller,
        address indexed messageTransmitter,
        address indexed token,
        uint256 forwardedAmount
    );
    event RescueTransfer(address indexed token, address indexed to, uint256 amount);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyManagerOrAdmin() {
        if (msg.sender != admin && msg.sender != manager) revert NotManagerOrAdmin();
        _;
    }

    constructor(address _admin, address _manager, address _transferTo) {
        if (_admin == address(0) || _manager == address(0) || _transferTo == address(0)) revert ZeroAddress();
        admin = _admin;
        manager = _manager;
        transferTo = _transferTo;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminUpdated(admin, newAdmin);
        admin = newAdmin;
    }

    function setManager(address newManager) external onlyAdmin {
        if (newManager == address(0)) revert ZeroAddress();
        emit ManagerUpdated(manager, newManager);
        manager = newManager;
    }

    function setTransferTo(address newTransferTo) external onlyAdmin {
        if (newTransferTo == address(0)) revert ZeroAddress();
        emit TransferToUpdated(transferTo, newTransferTo);
        transferTo = newTransferTo;
    }

    /// @notice Calls Circle MessageTransmitter.receiveMessage and forwards newly received tokens to transferTo.
    /// @dev For forwarding to work, the CCTP message recipient on destination chain must be this contract.
    function receiveMessageAndForward(
        address messageTransmitter,
        address token,
        bytes calldata message,
        bytes calldata attestation
    ) external onlyManagerOrAdmin returns (uint256 forwardedAmount) {
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        bool ok = IMessageTransmitter(messageTransmitter).receiveMessage(message, attestation);
        if (!ok) revert ReceiveMessageFailed();
        uint256 afterBal = IERC20(token).balanceOf(address(this));

        unchecked {
            forwardedAmount = afterBal > beforeBal ? (afterBal - beforeBal) : 0;
        }

        if (forwardedAmount > 0) {
            if (!IERC20(token).transfer(transferTo, forwardedAmount)) revert TokenTransferFailed();
        }

        emit MessageReceivedAndForwarded(msg.sender, messageTransmitter, token, forwardedAmount);
    }

    /// @notice Admin-only emergency token withdrawal.
    function rescue_transfer(address token, address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        if (!IERC20(token).transfer(to, amount)) revert TokenTransferFailed();
        emit RescueTransfer(token, to, amount);
    }
}


