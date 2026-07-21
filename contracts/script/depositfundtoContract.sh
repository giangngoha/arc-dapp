# Approve USDC cho MasterChef
cast send 0x3600000000000000000000000000000000000000 \
  "approve(address,uint256)" \
  0x66f4ea09cdcad01061e1e13ab29c48ee05e9e5c4 \
  1000000000 \
  --rpc-url arc --account deployer

# Fund 1000 USDC vào reward pool
cast send 0x66f4ea09cdcad01061e1e13ab29c48ee05e9e5c4 \
  "fundRewards(uint256)" \
  1000000000 \
  --rpc-url arc --account deployer