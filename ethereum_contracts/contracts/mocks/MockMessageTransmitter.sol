// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IMintable {
    function mint(address to, uint256 amount) external;
}

contract MockMessageTransmitter {
    address public immutable token;
    address public recipient;
    uint256 public amountToMint;

    constructor(address _token, address _recipient, uint256 _amountToMint) {
        token = _token;
        recipient = _recipient;
        amountToMint = _amountToMint;
    }

    function setRecipient(address newRecipient) external {
        recipient = newRecipient;
    }

    function setAmountToMint(uint256 newAmount) external {
        amountToMint = newAmount;
    }

    // Mimics Circle MessageTransmitter interface.
    function receiveMessage(bytes calldata, bytes calldata) external returns (bool) {
        if (amountToMint > 0) {
            IMintable(token).mint(recipient, amountToMint);
        }
        return true;
    }
}


