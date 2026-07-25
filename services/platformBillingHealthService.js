import Company from "../models/company.js";
import Organization from "../models/organization.js";
import { resolveEffectiveBilling } from "./companyAppAccessService.js";

const HEALTHY_BILLING_STATUSES = new Set(["trial", "active", "manual"]);
const PAYMENT_ATTENTION_STATUSES = new Set(["unpaid", "past_due", "failed"]);

const toId = (value) => value?._id?.toString?.() || value?.toString?.() || null;

const buildAction = ({
  type,
  severity,
  title,
  description,
  organization = null,
  company = null,
}) => ({
  type,
  severity,
  title,
  description,
  organizationId: toId(organization),
  organizationName: organization?.name || null,
  companyId: toId(company),
  companyName: company?.displayName || company?.name || null,
});

export const getCompanyEffectiveBillingHealth = async (company) => {
  const effective = await resolveEffectiveBilling(company);
  const actions = [];

  if (effective.source === "organization" && !company.organizationId) {
    actions.push(
      buildAction({
        type: "billing_structure",
        severity: "critical",
        title: "Inherited billing has no Organization",
        description:
          "This Company is configured for Organization billing but is not attached to an Organization.",
        company,
      }),
    );
  }

  if (!effective.valid) {
    actions.push(
      buildAction({
        type: "billing_status",
        severity: "critical",
        title:
          effective.source === "organization"
            ? "Organization billing requires attention"
            : "Company billing requires attention",
        description: effective.issue || "No valid billing source is active.",
        organization: effective.organization,
        company,
      }),
    );
  }

  if (PAYMENT_ATTENTION_STATUSES.has(effective.billing?.paymentStatus)) {
    actions.push(
      buildAction({
        type: "payment_status",
        severity: "critical",
        title: "Payment requires attention",
        description: `Effective payment status is ${effective.billing.paymentStatus.replaceAll("_", " ")}.`,
        organization: effective.organization,
        company,
      }),
    );
  }

  return {
    source: effective.source,
    sourceLabel:
      effective.source === "organization"
        ? `Inherited from ${effective.organization?.name || "Organization"}`
        : "Billed individually",
    organization: effective.organization,
    plan: effective.plan,
    billingStatus: effective.billing?.status || "not_configured",
    paymentStatus: effective.billing?.paymentStatus || "not_configured",
    trialEndDate: effective.billing?.trialEndDate || null,
    renewalDate: effective.billing?.renewalDate || null,
    contractEndDate: effective.billing?.contractEndDate || null,
    creditsRemaining: effective.billing?.creditsRemaining ?? null,
    valid: effective.valid,
    issue: effective.issue,
    actions,
  };
};

export const getPlatformBillingHealth = async () => {
  const [companies, organizations] = await Promise.all([
    Company.find({ isPlatformWorkspace: { $ne: true } }).lean(),
    Organization.find({ status: { $ne: "archived" } }).lean(),
  ]);

  const organizationById = new Map(
    organizations.map((organization) => [toId(organization), organization]),
  );
  const companiesByOrganization = new Map();

  for (const company of companies) {
    const organizationId = toId(company.organizationId);
    if (!organizationId) continue;
    const list = companiesByOrganization.get(organizationId) || [];
    list.push(company);
    companiesByOrganization.set(organizationId, list);
  }

  const companyHealth = await Promise.all(
    companies.map(async (company) => ({
      company,
      health: await getCompanyEffectiveBillingHealth(company),
    })),
  );

  const actions = companyHealth.flatMap(({ health }) => health.actions);

  for (const organization of organizations) {
    const attachedCompanies = companiesByOrganization.get(toId(organization)) || [];

    if (attachedCompanies.length === 0) {
      actions.push(
        buildAction({
          type: "organization_structure",
          severity: "warning",
          title: "Organization has no Companies",
          description:
            "This Organization is active but no customer Company is attached to it.",
          organization,
        }),
      );
    }

    if (organization.billingMode === "organization") {
      if (!HEALTHY_BILLING_STATUSES.has(organization.billing?.status)) {
        actions.push(
          buildAction({
            type: "organization_billing",
            severity: "critical",
            title: "HQ billing is not active",
            description:
              "Companies inheriting from this Organization do not have a valid effective billing source.",
            organization,
          }),
        );
      }

      const individualExceptions = attachedCompanies.filter(
        (company) => company.billingSource === "company",
      );

      if (individualExceptions.length > 0) {
        actions.push(
          buildAction({
            type: "mixed_billing",
            severity: "warning",
            title: "Organization has mixed billing",
            description: `${individualExceptions.length} attached Compan${individualExceptions.length === 1 ? "y uses" : "ies use"} individual billing while HQ billing is enabled.`,
            organization,
          }),
        );
      }
    }

    if (organization.billingMode === "company") {
      const invalidInheritedCompanies = attachedCompanies.filter(
        (company) => company.billingSource === "organization",
      );

      if (invalidInheritedCompanies.length > 0) {
        actions.push(
          buildAction({
            type: "billing_structure",
            severity: "critical",
            title: "Companies inherit from disabled HQ billing",
            description: `${invalidInheritedCompanies.length} attached Compan${invalidInheritedCompanies.length === 1 ? "y is" : "ies are"} configured to inherit billing although Organization billing is disabled.`,
            organization,
          }),
        );
      }
    }

    if (
      organization.billing?.maxCompanies != null &&
      attachedCompanies.length > organization.billing.maxCompanies
    ) {
      actions.push(
        buildAction({
          type: "plan_limit",
          severity: "critical",
          title: "Organization Company limit exceeded",
          description: `${attachedCompanies.length} Companies are attached but the billing limit is ${organization.billing.maxCompanies}.`,
          organization,
        }),
      );
    }
  }

  const uniqueActions = Array.from(
    new Map(
      actions.map((action) => [
        [
          action.type,
          action.organizationId || "none",
          action.companyId || "none",
          action.title,
        ].join(":"),
        action,
      ]),
    ).values(),
  );

  uniqueActions.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
  });

  return {
    summary: {
      totalOrganizations: organizations.length,
      organizationBillingCount: organizations.filter(
        (organization) => organization.billingMode === "organization",
      ).length,
      companyBillingCount: companies.filter(
        (company) => company.billingSource !== "organization",
      ).length,
      inheritedBillingCount: companies.filter(
        (company) => company.billingSource === "organization",
      ).length,
      healthyBillingCount: companyHealth.filter(({ health }) => health.valid).length,
      billingAttentionCount: uniqueActions.length,
      criticalBillingCount: uniqueActions.filter(
        (action) => action.severity === "critical",
      ).length,
    },
    actions: uniqueActions,
    companies: companyHealth.map(({ company, health }) => ({
      companyId: toId(company),
      companyName: company.displayName || company.name,
      organizationId: toId(company.organizationId),
      ...health,
    })),
  };
};

export default getPlatformBillingHealth;
