/** OSS has no platform-admin response API. Kept so Results Analysis can share Platform code. */
export class AdminResultsError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AdminResultsError';
    Object.assign(this, extra);
  }
}

export async function fetchAdminResponsePage() {
  throw new AdminResultsError('Platform admin response loading is not available in the self-hosted edition.', {
    code: 'ADMIN_RESULTS_UNAVAILABLE',
    stage: 'oss',
    status: 404,
  });
}
