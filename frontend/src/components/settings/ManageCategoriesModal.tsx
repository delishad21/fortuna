"use client";

import { useState } from "react";
import { Tags, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { ColorSelect } from "@/components/ui/ColorSelect";
import { CategoryIconSelect } from "@/components/ui/CategoryIconSelect";
import type { Category } from "@/app/actions/categories";

interface ManageCategoriesModalProps {
  isOpen: boolean;
  categories: Category[];
  lockedCategoryNames?: string[];
  newCategory: { name: string; color: string; icon: string };
  onClose: () => void;
  onNewCategoryChange: (next: { name: string; color: string; icon: string }) => void;
  onAddCategory: () => void | Promise<void>;
  onCategoryNameChange: (id: string, name: string) => void;
  onCategoryColorChange: (id: string, color: string) => void;
  onCategoryIconChange: (id: string, icon: string) => void;
  onDeleteCategory: (id: string) => void;
  onSaveAll: () => void | Promise<void>;
}

export function ManageCategoriesModal({
  isOpen,
  categories,
  lockedCategoryNames = [],
  newCategory,
  onClose,
  onNewCategoryChange,
  onAddCategory,
  onCategoryNameChange,
  onCategoryColorChange,
  onCategoryIconChange,
  onDeleteCategory,
  onSaveAll,
}: ManageCategoriesModalProps) {
  if (!isOpen) return null;
  const [showAddForm, setShowAddForm] = useState(false);
  const lockedSet = new Set(lockedCategoryNames.map((item) => item.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-2 rounded-lg shadow-[var(--shadow-card-2)] w-full max-w-3xl">
        <div className="p-6 border-b border-stroke dark:border-dark-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-orange-light-3 dark:bg-orange-dark-2/60 text-orange flex items-center justify-center">
              <Tags className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                Manage Categories
              </h2>
              <p className="text-sm text-dark-5 dark:text-dark-6 mt-0.5">
                Edit names, colors or icons, or add new categories.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {showAddForm ? (
            <div className="rounded-lg border border-stroke dark:border-dark-3 p-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    New category
                  </label>
                  <div className="flex items-center gap-3">
                    <ColorSelect
                      value={newCategory.color}
                      onChange={(color) =>
                        onNewCategoryChange({ ...newCategory, color })
                      }
                    />
                    <CategoryIconSelect
                      value={newCategory.icon}
                      name={newCategory.name}
                      color={newCategory.color}
                      onChange={(icon) =>
                        onNewCategoryChange({ ...newCategory, icon })
                      }
                    />
                    <TextInput
                      value={newCategory.name}
                      onChange={(e) =>
                        onNewCategoryChange({
                          ...newCategory,
                          name: e.target.value,
                        })
                      }
                      placeholder="e.g., Groceries"
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowAddForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={onAddCategory}
                  >
                    Add Category
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setShowAddForm(true)}
              >
                Add Category
              </Button>
            </div>
          )}

          <div className="space-y-3 max-h-[55vh] overflow-auto pr-2">
            {categories.map((category) => (
              <div key={category.id} className="flex items-center gap-3">
                <ColorSelect
                  value={category.color}
                  onChange={(color) => onCategoryColorChange(category.id, color)}
                />
                <CategoryIconSelect
                  value={category.icon}
                  name={category.name}
                  color={category.color}
                  onChange={(icon) => onCategoryIconChange(category.id, icon)}
                />
                <div className="flex-1 min-w-[200px]">
                  <TextInput
                    value={category.name}
                    onChange={(e) =>
                      onCategoryNameChange(category.id, e.target.value)
                    }
                    className="w-full"
                    disabled={lockedSet.has(category.name.toLowerCase())}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteCategory(category.id)}
                  disabled={lockedSet.has(category.name.toLowerCase())}
                  className="h-9 w-9 rounded-lg border border-stroke dark:border-dark-3 text-red hover:border-red hover:text-red-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                  title={
                    lockedSet.has(category.name.toLowerCase())
                      ? "Trip categories cannot be deleted"
                      : "Delete category"
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {categories.length === 0 && (
              <div className="text-sm text-dark-5 dark:text-dark-6">
                No categories yet.
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={onSaveAll}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
