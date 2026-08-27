const CAUSAL_LEVELS = Object.freeze(['NONE', 'OBSERVATIONAL', 'STRONG_OBSERVATIONAL', 'EXPERIMENTAL', 'CAUSAL_VALIDATED']);

function causalLanguage(level, positive = true) {
  if (!CAUSAL_LEVELS.includes(level)) return positive ? 'may be associated with' : 'is not proven to have caused';
  if (level === 'CAUSAL_VALIDATED') return positive ? 'caused' : 'did not cause';
  if (level === 'EXPERIMENTAL') return positive ? 'produced an experimentally observed effect on' : 'did not produce a measured experimental effect on';
  if (level === 'STRONG_OBSERVATIONAL') return positive ? 'is strongly associated with' : 'has no strong observed association with';
  return positive ? 'is associated with' : 'is not proven to have caused';
}

function canUseCausalClaim(level) {
  return ['EXPERIMENTAL', 'CAUSAL_VALIDATED'].includes(level);
}

module.exports = { CAUSAL_LEVELS, canUseCausalClaim, causalLanguage };
