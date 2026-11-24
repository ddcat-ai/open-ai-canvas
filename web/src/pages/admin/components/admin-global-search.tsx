import { AutoComplete, Input } from "antd";
import { Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { searchAdminNavigation, type AdminSearchEntry } from "../lib/navigation-search";
import "./admin-global-search.css";

export function AdminGlobalSearch({ entries }: { entries: readonly AdminSearchEntry[] }) {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const results = searchAdminNavigation(entries, query);
    return (
        <div className="admin-global-search" role="search" aria-label="后台页面搜索">
            <AutoComplete<string, { value: string; label: ReactNode; disabled?: boolean }>
                value={query}
                onChange={setQuery}
                allowClear
                virtual={false}
                showSearch={{ filterOption: false }}
                options={
                    results.length
                        ? results.map((entry) => ({
                              value: entry.path,
                              label: (
                                  <span className="admin-global-search-result">
                                      <strong>{entry.label}</strong>
                                      <small>{entry.group}</small>
                                  </span>
                              ),
                          }))
                        : [{ value: "", disabled: true, label: <span role="status">未找到对应后台页面，请更换关键词</span> }]
                }
                onSelect={(path) => {
                    if (!entries.some((entry) => entry.path === path)) return;
                    setQuery("");
                    navigate(path);
                }}
            >
                <Input aria-label="搜索后台页面" placeholder="搜索后台页面或功能…" prefix={<Search className="size-4" aria-hidden="true" />} />
            </AutoComplete>
        </div>
    );
}
