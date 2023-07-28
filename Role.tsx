interface userGetItf {
    /**描述 */
    id: string
}

export async function userGet(params: userGetItf): Promise< VoloAbpIdentityRoleDto > {
    const path: string = `/api/identity/roles/${params.id}`
    return http.get(path);
}

export interface VoloAbpIdentityRoleDto {
    id: string;
    name?: string;
    isDefault: boolean;
    isPublic: boolean;
}