// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MasterChef
/// @notice Yield farming contract that distributes USDC rewards to LP token stakers.
///         Inspired by SushiSwap MasterChef v1, simplified for Arc Testnet.
///
/// Flow:
///   1. Owner deploys contract, funds it with USDC reward budget.
///   2. Owner adds LP token pools (USDC/EURC, USDC/cirBTC, EURC/cirBTC).
///   3. Users stake LP tokens → earn USDC rewards proportional to their share × time.
///   4. Users call claim() or unstake() to collect accrued rewards.
///
/// Reward math (standard Uniswap/Sushi accumulator pattern):
///   accRewardPerShare += rewardPerSecond × allocPoint / totalAllocPoint × elapsed / totalStaked
///   pendingReward = user.amount × accRewardPerShare - user.rewardDebt
///
/// All reward amounts are in USDC (6 decimals).

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract MasterChef {

    // ─── Data structures ──────────────────────────────────────────────────────

    struct PoolInfo {
        address lpToken;         // Address of the LP token contract
        uint256 allocPoint;      // Reward weight relative to other pools
        uint256 lastRewardTime;  // Last Unix timestamp rewards were distributed
        uint256 accRewardPerShare; // Accumulated reward per share (scaled by 1e12)
        uint256 totalStaked;     // Total LP tokens currently staked in this pool
    }

    struct UserInfo {
        uint256 amount;      // LP tokens the user has staked
        uint256 rewardDebt;  // Reward debt for the accumulator formula (scaled by 1e12)
    }

    // ─── State ────────────────────────────────────────────────────────────────

    address public owner;
    IERC20  public immutable rewardToken; // USDC on Arc Testnet

    /// @notice Total USDC reward distributed per second across all pools.
    ///         Owner can adjust via setRewardPerSecond().
    uint256 public rewardPerSecond;

    /// @notice Sum of allocPoints across all pools.
    ///         A pool's share of rewards = allocPoint / totalAllocPoint.
    uint256 public totalAllocPoint;

    PoolInfo[] public pools;

    /// @notice poolIndex → userAddress → UserInfo
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    /// @notice Prevent adding the same LP token twice
    mapping(address => bool) public lpTokenAdded;

    // Precision multiplier for fixed-point reward math
    uint256 private constant ACC_PRECISION = 1e12;

    // ─── Events ───────────────────────────────────────────────────────────────

    event PoolAdded(uint256 indexed pid, address indexed lpToken, uint256 allocPoint);
    event AllocUpdated(uint256 indexed pid, uint256 allocPoint);
    event Stake(address indexed user, uint256 indexed pid, uint256 amount);
    event Unstake(address indexed user, uint256 indexed pid, uint256 amount);
    event Claim(address indexed user, uint256 indexed pid, uint256 reward);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event RewardPerSecondUpdated(uint256 oldRate, uint256 newRate);
    event RewardFunded(address indexed funder, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error InvalidPool();
    error ZeroAmount();
    error AlreadyAdded();
    error InsufficientRewardBalance();
    error TransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _rewardToken USDC token address on Arc Testnet
    /// @param _rewardPerSecond Initial reward rate (in USDC smallest unit, i.e. 6 decimals)
    ///        Example: 0.001 USDC/s = 86.4 USDC/day → pass 1000 (= 0.001 × 10^6)
    constructor(address _rewardToken, uint256 _rewardPerSecond) {
        owner = msg.sender;
        rewardToken = IERC20(_rewardToken);
        rewardPerSecond = _rewardPerSecond;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier validPool(uint256 pid) {
        if (pid >= pools.length) revert InvalidPool();
        _;
    }

    // ─── Owner functions ──────────────────────────────────────────────────────

    /// @notice Add a new LP token pool.
    /// @param _lpToken   Address of the Uniswap V2 pair (LP token)
    /// @param _allocPoint Reward weight. Higher = more rewards.
    ///        Example: 3 pools with allocPoints [50, 30, 20] split rewards 50/30/20%.
    function addPool(address _lpToken, uint256 _allocPoint) external onlyOwner {
        if (lpTokenAdded[_lpToken]) revert AlreadyAdded();

        // Update all pools before changing totalAllocPoint to avoid reward miscalculation
        massUpdatePools();

        totalAllocPoint += _allocPoint;
        lpTokenAdded[_lpToken] = true;

        pools.push(PoolInfo({
            lpToken:          _lpToken,
            allocPoint:       _allocPoint,
            lastRewardTime:   block.timestamp,
            accRewardPerShare: 0,
            totalStaked:      0
        }));

        emit PoolAdded(pools.length - 1, _lpToken, _allocPoint);
    }

    /// @notice Update a pool's allocation point (rebalances reward split).
    function setAllocPoint(uint256 pid, uint256 _allocPoint) external onlyOwner validPool(pid) {
        massUpdatePools();
        totalAllocPoint = totalAllocPoint - pools[pid].allocPoint + _allocPoint;
        pools[pid].allocPoint = _allocPoint;
        emit AllocUpdated(pid, _allocPoint);
    }

    /// @notice Adjust the global reward emission rate.
    ///         Call massUpdatePools() before changing to lock in accumulated rewards.
    function setRewardPerSecond(uint256 _rewardPerSecond) external onlyOwner {
        massUpdatePools();
        emit RewardPerSecondUpdated(rewardPerSecond, _rewardPerSecond);
        rewardPerSecond = _rewardPerSecond;
    }

    /// @notice Fund the contract with USDC to pay out rewards.
    ///         Owner must call token.approve(masterChef, amount) first.
    function fundRewards(uint256 amount) external onlyOwner {
        bool ok = rewardToken.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();
        emit RewardFunded(msg.sender, amount);
    }

    /// @notice Transfer ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ─── Pool update logic ────────────────────────────────────────────────────

    /// @notice Update reward accumulators for all pools.
    ///         Call before any operation that changes totalAllocPoint or rewardPerSecond.
    function massUpdatePools() public {
        uint256 len = pools.length;
        for (uint256 i = 0; i < len; ) {
            _updatePool(i);
            unchecked { ++i; }
        }
    }

    /// @notice Update the accumulator for a single pool.
    function updatePool(uint256 pid) public validPool(pid) {
        _updatePool(pid);
    }

    function _updatePool(uint256 pid) internal {
        PoolInfo storage pool = pools[pid];

        if (block.timestamp <= pool.lastRewardTime) return;
        if (pool.totalStaked == 0 || pool.allocPoint == 0) {
            pool.lastRewardTime = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - pool.lastRewardTime;
        // This pool's share of global rewards for the elapsed period
        uint256 reward = elapsed * rewardPerSecond * pool.allocPoint / totalAllocPoint;

        // Cap reward to available contract balance — prevents over-promising
        uint256 available = rewardToken.balanceOf(address(this));
        if (reward > available) reward = available;

        pool.accRewardPerShare += reward * ACC_PRECISION / pool.totalStaked;
        pool.lastRewardTime = block.timestamp;
    }

    // ─── User functions ───────────────────────────────────────────────────────

    /// @notice Stake LP tokens into a farm pool.
    ///         User must approve this contract for the LP token first.
    /// @param pid    Pool index
    /// @param amount Amount of LP tokens to stake (18 decimals)
    function stake(uint256 pid, uint256 amount) external validPool(pid) {
        if (amount == 0) revert ZeroAmount();

        _updatePool(pid);

        PoolInfo storage pool = pools[pid];
        UserInfo storage user = userInfo[pid][msg.sender];

        // Claim any pending rewards before updating user's staked amount
        if (user.amount > 0) {
            uint256 pending = user.amount * pool.accRewardPerShare / ACC_PRECISION - user.rewardDebt;
            if (pending > 0) _safeRewardTransfer(msg.sender, pending);
        }

        bool ok = IERC20(pool.lpToken).transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        user.amount     += amount;
        pool.totalStaked += amount;

        // Snapshot current accumulator so future claims only count from now
        user.rewardDebt = user.amount * pool.accRewardPerShare / ACC_PRECISION;

        emit Stake(msg.sender, pid, amount);
    }

    /// @notice Unstake LP tokens and claim all pending rewards.
    /// @param pid    Pool index
    /// @param amount LP tokens to withdraw (pass user.amount to exit fully)
    function unstake(uint256 pid, uint256 amount) external validPool(pid) {
        if (amount == 0) revert ZeroAmount();

        _updatePool(pid);

        PoolInfo storage pool = pools[pid];
        UserInfo storage user = userInfo[pid][msg.sender];

        require(user.amount >= amount, "MasterChef: insufficient staked balance");

        // Claim all pending rewards
        uint256 pending = user.amount * pool.accRewardPerShare / ACC_PRECISION - user.rewardDebt;
        if (pending > 0) _safeRewardTransfer(msg.sender, pending);

        user.amount     -= amount;
        pool.totalStaked -= amount;
        user.rewardDebt  = user.amount * pool.accRewardPerShare / ACC_PRECISION;

        bool ok = IERC20(pool.lpToken).transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();

        emit Unstake(msg.sender, pid, amount);
    }

    /// @notice Claim pending USDC rewards without touching staked LP tokens.
    function claim(uint256 pid) external validPool(pid) {
        _updatePool(pid);

        PoolInfo storage pool = pools[pid];
        UserInfo storage user = userInfo[pid][msg.sender];

        uint256 pending = user.amount * pool.accRewardPerShare / ACC_PRECISION - user.rewardDebt;
        if (pending > 0) {
            _safeRewardTransfer(msg.sender, pending);
            user.rewardDebt = user.amount * pool.accRewardPerShare / ACC_PRECISION;
            emit Claim(msg.sender, pid, pending);
        }
    }

    /// @notice Emergency withdraw — returns LP tokens without claiming rewards.
    ///         Use only if contract has a bug and normal unstake is blocked.
    function emergencyWithdraw(uint256 pid) external validPool(pid) {
        PoolInfo storage pool = pools[pid];
        UserInfo storage user = userInfo[pid][msg.sender];

        uint256 amount = user.amount;
        if (amount == 0) return;

        user.amount     = 0;
        user.rewardDebt = 0;
        pool.totalStaked -= amount;

        bool ok = IERC20(pool.lpToken).transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();

        emit EmergencyWithdraw(msg.sender, pid, amount);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /// @notice Number of pools registered.
    function poolLength() external view returns (uint256) {
        return pools.length;
    }

    /// @notice Pending USDC reward for a user in a given pool.
    ///         This is what the UI shows as "Pending reward".
    function pendingReward(uint256 pid, address _user) external view validPool(pid) returns (uint256) {
        PoolInfo storage pool = pools[pid];
        UserInfo storage user = userInfo[pid][_user];

        uint256 acc = pool.accRewardPerShare;

        // Simulate what _updatePool would do without writing to state
        if (block.timestamp > pool.lastRewardTime && pool.totalStaked > 0 && pool.allocPoint > 0) {
            uint256 elapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward  = elapsed * rewardPerSecond * pool.allocPoint / totalAllocPoint;
            uint256 available = rewardToken.balanceOf(address(this));
            if (reward > available) reward = available;
            acc += reward * ACC_PRECISION / pool.totalStaked;
        }

        return user.amount * acc / ACC_PRECISION - user.rewardDebt;
    }

    /// @notice Current Farm APR for a pool (annualised, in basis points: 10000 = 100%).
    ///         UI divides by 100 to display as percentage.
    ///         NOTE: LP token price in USD must be provided off-chain since
    ///         the contract has no price oracle. The UI passes tvlUSD from pool reserves.
    /// @param pid    Pool index
    /// @param tvlStakedUSD Total USD value of staked LP tokens (6-decimal precision)
    /// @return aprBps Annual percentage rate in basis points (100% = 10000)
    function aprBps(uint256 pid, uint256 tvlStakedUSD) external view validPool(pid) returns (uint256) {
        if (tvlStakedUSD == 0 || totalAllocPoint == 0) return 0;
        PoolInfo storage pool = pools[pid];
        // rewardPerYear (6 decimals) = rewardPerSecond × 31536000 × allocShare
        uint256 rewardPerYear = rewardPerSecond * 31_536_000 * pool.allocPoint / totalAllocPoint;
        // APR bps = rewardPerYear / tvlStakedUSD × 10000
        return rewardPerYear * 10_000 / tvlStakedUSD;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Transfer reward, capped to available balance (never reverts on shortfall).
    function _safeRewardTransfer(address to, uint256 amount) internal {
        uint256 bal = rewardToken.balanceOf(address(this));
        uint256 send = amount > bal ? bal : amount;
        if (send > 0) {
            bool ok = rewardToken.transfer(to, send);
            if (!ok) revert TransferFailed();
        }
    }
}
