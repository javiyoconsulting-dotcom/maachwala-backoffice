const db = require('./db');

function mapOrganizationToContractedOrg(organization) {
  return {
    name: organization.name,
    usercount: organization.headcount,
    businessregion: organization.businessregion,
    businesstype: organization.businesstype,
    status: true,
    data: organization.data,
    number: Date.now(),
  };
}

async function createOrganization(organization) {
  const contractedOrg = mapOrganizationToContractedOrg(organization);
  const result = await db.query(
    `
      INSERT INTO core.contractedorg (
        name,
        usercount,
        businessregion,
        businesstype,
        status,
        data,
        "number"
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING
        id,
        name,
        usercount,
        businessregion,
        businesstype,
        status,
        data,
        "number",
        created_at AS "createdAt"
    `,
    [
      contractedOrg.name,
      contractedOrg.usercount,
      contractedOrg.businessregion,
      contractedOrg.businesstype,
      contractedOrg.status,
      JSON.stringify(contractedOrg.data),
      contractedOrg.number,
    ],
  );

  return result.rows[0];
}

module.exports = {
  createOrganization,
  mapOrganizationToContractedOrg,
};
