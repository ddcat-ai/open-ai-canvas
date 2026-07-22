import { AdminPageFrame } from "../components/admin-shell";
import { useAdminContext } from "../admin-context";
import UsersPanel from "./users-panel";

export default function UsersPage() {
    const { updateUserReference } = useAdminContext();
    return (
        <AdminPageFrame title="用户管理" description="账号、角色与状态">
            <UsersPanel onUserChanged={updateUserReference} />
        </AdminPageFrame>
    );
}
