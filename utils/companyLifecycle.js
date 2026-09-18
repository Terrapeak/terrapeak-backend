export const isCompanyArchived = (company) =>
  company?.lifecycleStatus === "archived" || company?.isActive === false;

export const isCompanyOperational = (company) =>
  Boolean(company) && !isCompanyArchived(company);
