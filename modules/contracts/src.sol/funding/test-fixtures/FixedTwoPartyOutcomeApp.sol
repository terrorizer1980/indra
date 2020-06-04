pragma solidity ^0.6.4;
pragma experimental "ABIEncoderV2";

import "../../adjudicator/interfaces/CounterfactualApp.sol";
import "../libs/LibOutcome.sol";


contract TwoPartyFixedOutcomeApp is CounterfactualApp {
  function computeOutcome(
    bytes calldata /* encodedState */
  ) external override view returns (bytes memory) {
    return abi.encode(LibOutcome.TwoPartyFixedOutcome.SPLIT_AND_SEND_TO_BOTH_ADDRS);
  }
}