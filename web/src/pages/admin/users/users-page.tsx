import { AdminPageFrame } from "../components/admin-shell";
import { useAdminContext } from "../admin-context";
import UsersPanel from "./users-panel";
import { useTranslation } from "react-i18next";

export default function UsersPage() {
    const { t } = useTranslation("canvas");
    const { updateUserReference } = useAdminContext();
    return (
        <AdminPageFrame title={t("admin:users")} description={t("admin:accounts-roles-and-statuses")}>
            <UsersPanel onUserChanged={updateUserReference} />
        </AdminPageFrame>
    );
}
