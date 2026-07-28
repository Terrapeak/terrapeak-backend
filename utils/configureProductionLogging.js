const SENSITIVE_LOG_PREFIXES = new Set([
  "SAVE SETTINGS USER:",
  "SAVE BODY brandName:",
  "file ",
  "conttett in backend ",
  "hlo",
]);

const configureProductionLogging = () => {
  if (process.env.NODE_ENV !== "production") return;

  const originalLog = console.log.bind(console);

  console.log = (...args) => {
    const firstArgument = args[0];

    if (
      typeof firstArgument === "string" &&
      SENSITIVE_LOG_PREFIXES.has(firstArgument)
    ) {
      return;
    }

    originalLog(...args);
  };
};

export default configureProductionLogging;
