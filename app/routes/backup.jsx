import {
  Page,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Button,
  Spinner,
  Thumbnail,
  Frame,
  TextField,
  Select,
  ButtonGroup,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState, useCallback, useMemo } from "react";

function fetchProducts(searchTerm = "", afterCursor = null) {
  return fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
      query ($query: String, $after: String) {
        products(first: 10, query: $query, after: $after) {
          edges {
            cursor
            node {
              id
              title
              metafields(first: 10) {
                edges {
                  node {
                    id
                    key
                    value
                    type
                    reference {
                      ... on Product {
                        id
                        title
                        images(first: 10) {
                          edges {
                            node {
                              url
                            }
                          }
                        }
                      }
                    }
                    references(first: 10) {
                      edges {
                        node {
                          ... on Product {
                            id
                            title
                            images(first: 10) {
                              edges {
                                node {
                                  url
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
      `,
      variables: {
        query: searchTerm ? `title:*${searchTerm}*` : "",
        after: afterCursor,
      },
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      return data;
    });
}

async function updateMetafield(productId, gifts, metafieldData) {
  const mutation = `
    mutation updateProductMetafield($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          metafields(first: 10) {
            edges {
              node {
                id
                namespace
                key
                value
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variantReferences = metafieldData.type.name.includes("list")
    ? gifts.map((gift) => `${gift.id}`)
    : gifts.length > 0
      ? gifts[0].id
      : null;

  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: metafieldData.namespace,
          key: metafieldData.key,
          value: metafieldData.type.name.includes("list")
            ? JSON.stringify(variantReferences)
            : variantReferences,
          type: metafieldData.type.name,
        },
      ],
    },
  };

  try {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const result = await response.json();
    if (result.data && result.data.productUpdate) {
      console.log("Metafield updated successfully");
    } else {
      console.error("Error updating metafield:", result.errors || result.data.productUpdate.userErrors);
    }
  } catch (error) {
    console.error("Request failed:", error);
  }
}

async function updateProductMetafield(productId, value, activeMetafieldData) {
  const query = `
    mutation updateProductMetafield($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          metafields(first: 10) {
            edges {
              node {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const metafieldValue = value === null || value === "" ? "" : value;
  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: activeMetafieldData.namespace,
          key: activeMetafieldData.key,
          value: metafieldValue,
          type: activeMetafieldData.type.name,
        },
      ],
    },
  };
  try {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const responseData = await response.json();
    if (responseData.errors) {
      console.error("Error updating metafield:", responseData.errors);
      return { success: false, errors: responseData.errors };
    } else if (responseData.data.productUpdate.userErrors.length > 0) {
      return { success: false, userErrors: responseData.data.productUpdate.userErrors };
    } else {
      const updatedMetafields = responseData.data.productUpdate.product.metafields.edges.map(
        (edge) => edge.node
      );
      return { success: true, metafields: updatedMetafields };
    }
  } catch (error) {
    console.error("Request failed:", error);
    return { success: false, errors: error.message };
  }
}

async function deleteMetafield(metafieldId) {
  const mutation = `
    mutation metafieldDelete($input: MetafieldDeleteInput!) {
      metafieldDelete(input: $input) {
        deletedId
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = { input: { id: metafieldId } };
  try {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const result = await response.json();
    if (result.data?.metafieldDelete?.deletedId) {
      return { success: true, deletedId: result.data.metafieldDelete.deletedId };
    } else {
      console.error("Error deleting metafield:", result.errors || result.data?.metafieldDelete?.userErrors);
      return { success: false, errors: result.errors || result.data?.metafieldDelete?.userErrors };
    }
  } catch (error) {
    console.error("Request failed:", error);
    return { success: false, errors: error.message };
  }
}

// Helper to merge group state updates
const mergeGroupState = (prev, groupId, newData) => {
  const current = prev[groupId] || {};
  const merged = { ...current };
  Object.keys(newData).forEach((key) => {
    merged[key] = current[key] ? [...current[key], ...newData[key]] : newData[key];
  });
  return { ...prev, [groupId]: merged };
};

export default function SelectFreeGift({ groupId, activeTabIndex, associatedMetafields }) {
  const app = useAppBridge();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedProductsByGroup, setSelectedProductsByGroup] = useState({});
  const [initialProductsByGroup, setInitialProductsByGroup] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState("");
  const [saveButton, setSaveButton] = useState({});
  const [disabledSaveButton, setDisabledSaveButton] = useState({});
  const [textInput, setTextInput] = useState({});
  const [isProductMetafield, setIsProductMetafield] = useState(false);

  const options = useMemo(
    () =>
      associatedMetafields?.map((group) => ({
        label: group.name,
        value: group.key,
        type: group.type,
      })) || [],
    [associatedMetafields]
  );

  const loadProducts = useCallback(
    async (afterCursor = null, append = false) => {
      setLoading(true);
      const data = await fetchProducts(searchTerm, afterCursor);
      const formattedProducts = data.data.products.edges.map((edge) => {
        const product = edge.node;
        const giftMetafield = product.metafields?.edges?.find(
          (m) => m.node.key === "recommendations"
        );
        const prePopulatedVariants = giftMetafield
          ? JSON.parse(giftMetafield.node.value).map((variantId) => ({
            id: variantId,
            title: "Gift Variant",
            productTitle: product.title,
            isVariant: true,
          }))
          : [];
        return {
          id: product.id,
          title: product.title,
          prePopulatedVariants,
          metafields: product.metafields?.edges?.map((m) => {
            const metafield = m.node;
            let referenceProducts = [];
            if (metafield.reference) {
              referenceProducts.push({
                id: metafield.reference.id,
                title: metafield.reference.title,
                images: metafield.reference.images.edges.map((img) => img.node.url),
              });
            }
            if (metafield.references) {
              referenceProducts = metafield.references.edges.map((refEdge) => ({
                id: refEdge.node.id,
                title: refEdge.node.title,
                images: refEdge.node.images.edges.map((img) => img.node.url),
              }));
            }
            return {
              id: metafield.id,
              key: metafield.key,
              value: metafield.value,
              type: metafield.type,
              referenceProducts,
            };
          }) || [],
          cursor: edge.cursor,
        };
      });

      // Build text inputs and new selected products state
      const newTextInputValues = {};
      const newSelectedProductsObj = {};
      formattedProducts.forEach((product) => {
        product.metafields.forEach((metafield) => {
          newTextInputValues[metafield.key] = {
            ...(newTextInputValues[metafield.key] || {}),
            [product.id]: metafield.value || "",
          };
          let selections = [];
          const assocMeta = associatedMetafields.find((m) => m.key === metafield.key);
          if (assocMeta?.type.name.includes("list") && metafield.value) {
            try {
              const parsedIds = JSON.parse(metafield.value);
              selections = parsedIds.map((id) => {
                const productDetail = metafield.referenceProducts.find((ref) => ref.id === id);
                return {
                  id,
                  title: productDetail ? productDetail.title : "Product",
                  images: productDetail ? productDetail.images[0] : [],
                };
              });
            } catch (e) {
              console.error("Failed to parse metafield value", e);
            }
          } else if (metafield.referenceProducts && metafield.referenceProducts.length > 0) {
            selections = metafield.referenceProducts.map((refProd) => ({
              id: refProd.id,
              title: refProd.title,
              images: refProd.images,
            }));
          }
          if (selections.length > 0) {
            newSelectedProductsObj[metafield.key] = newSelectedProductsObj[metafield.key]
              ? [...newSelectedProductsObj[metafield.key], { productId: product.id, selections }]
              : [{ productId: product.id, selections }];
          }
        });
      });

      setProducts((prev) => (append ? [...prev, ...formattedProducts] : formattedProducts));
      setTextInput((prev) => (append ? { ...prev, ...newTextInputValues } : newTextInputValues));
      setSelectedProductsByGroup((prev) => mergeGroupState(prev, activeTabIndex, newSelectedProductsObj));
      setInitialProductsByGroup((prev) => mergeGroupState(prev, activeTabIndex, newSelectedProductsObj));

      setHasNextPage(data.data.products.pageInfo.hasNextPage);
      setNextCursor(
        data.data.products.pageInfo.hasNextPage
          ? data.data.products.edges[data.data.products.edges.length - 1].cursor
          : null
      );
      setLoading(false);
    },
    [searchTerm, activeTabIndex, associatedMetafields]
  );

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (associatedMetafields && associatedMetafields.length > 0) {
      setSelected(associatedMetafields[0].key);
      const sel = associatedMetafields[0];
      const isProd =
        sel?.type?.name === "list.product_reference" || sel?.type?.name === "product_reference";
      setIsProductMetafield(isProd);
    }
  }, [associatedMetafields]);

  const handleSearchChange = useCallback((value) => {
    setSearchTerm(value);
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const activeMetafieldData = associatedMetafields.find((m) => m.key === selected);
      const groupData = selectedProductsByGroup[activeTabIndex] || {};
      const groupSelected = groupData[selected] || [];
      const groupInitial = (initialProductsByGroup[activeTabIndex] || {})[selected] || [];

      const selectedMap = {};
      groupSelected.forEach((entry) => {
        selectedMap[entry.productId] = entry;
      });

      // Handle removals
      for (const initialEntry of groupInitial) {
        if (!selectedMap[initialEntry.productId]) {
          if (!activeMetafieldData.type.name.includes("list")) {
            const product = products.find((p) => p.id === initialEntry.productId);
            const metafield = product?.metafields?.find((m) => m.key === selected);
            if (metafield) {
              await deleteMetafield(metafield.id);
            }
          } else {
            await updateMetafield(initialEntry.productId, [], activeMetafieldData);
          }
        }
      }

      // Update changed entries
      for (const entry of groupSelected) {
        const productId = entry.productId;
        const initialEntry = groupInitial.find((item) => item.productId === productId);
        if (JSON.stringify(entry.selections) !== JSON.stringify(initialEntry?.selections || [])) {
          const selectedGifts = entry.selections.map((item) => ({ id: item.id, title: item.title }));
          await updateMetafield(productId, selectedGifts, activeMetafieldData);
        }
      }
      setHasChanges(false);
      console.log("Metafields updated for changed products.");
    },
    [associatedMetafields, selected, selectedProductsByGroup, initialProductsByGroup, activeTabIndex, products]
  );

  const openResourcePicker = useCallback(
    async (productId, metafieldType) => {
      const multiple = metafieldType.includes("list");
      const group = selectedProductsByGroup[activeTabIndex] || {};
      const currentEntries = group[selected] || [];
      const entry = currentEntries.find((e) => e.productId === productId);
      const entryIDs = entry ? entry.selections.map((item) => ({ id: item.id })) : [];

      const pickerResult = await app.resourcePicker({
        type: "product",
        filter: { variants: false },
        multiple,
        selectionIds: entryIDs,
      });

      if (pickerResult && pickerResult.selection) {
        setSelectedProductsByGroup((prev) => {
          const group = prev[activeTabIndex] || {};
          const currentEntries = group[selected] || [];
          const idx = currentEntries.findIndex((entry) => entry.productId === productId);
          let newEntry;
          if (!metafieldType.includes("list")) {
            newEntry = {
              productId,
              selections: [
                {
                  id: pickerResult.selection[0].id,
                  title: pickerResult.selection[0].title,
                  image: pickerResult.selection[0].images[0]?.src,
                  isVariant: false,
                },
              ],
            };
          } else {
            newEntry = {
              productId,
              selections: pickerResult.selection.map((item) => ({
                id: item.id,
                title: item.title,
                image: item.images[0]?.src,
                isVariant: false,
              })),
            };
          }
          const newEntries =
            idx !== -1
              ? currentEntries.map((entry) => (entry.productId === productId ? newEntry : entry))
              : [...currentEntries, newEntry];

          setHasChanges(true);
          return {
            ...prev,
            [activeTabIndex]: {
              ...group,
              [selected]: newEntries,
            },
          };
        });
      }
    },
    [activeTabIndex, app, selected, selectedProductsByGroup]
  );

  const removeProduct = useCallback(
    async (productId, selectedItemId) => {
      setSelectedProductsByGroup((prev) => {
        const group = prev[activeTabIndex] || {};
        const currentEntries = group[selected] || [];
        const entryIndex = currentEntries.findIndex((entry) => entry.productId === productId);
        if (entryIndex !== -1) {
          let newEntries;
          const selectedMetafield = associatedMetafields.find((m) => m.key === selected);
          if (!selectedMetafield?.type?.name.includes("list")) {
            newEntries = currentEntries.filter((entry) => entry.productId !== productId);
          } else {
            const updatedSelections = currentEntries[entryIndex].selections.filter(
              (item) => item.id !== selectedItemId
            );
            newEntries = currentEntries.map((entry) =>
              entry.productId === productId ? { productId, selections: updatedSelections } : entry
            );
          }
          setHasChanges(true);
          return {
            ...prev,
            [activeTabIndex]: {
              ...group,
              [selected]: newEntries,
            },
          };
        }
        return prev;
      });

      const productData = products.find((p) => p.id === productId);
      if (!productData) return;
      const productMetafield = productData.metafields.find((m) => m.key === selected);
      if (productMetafield?.id && productMetafield.id.startsWith("gid://shopify/Metafield/")) {
        try {
          await deleteMetafield(productMetafield.id);
        } catch (error) {
          console.error("Error deleting metafield:", error);
        }
      }
    },
    [activeTabIndex, associatedMetafields, products, selected]
  );

  const toggleSaveButtonState = useCallback((id, state) => {
    setDisabledSaveButton((prev) => ({ ...prev, [id]: state }));
  }, []);

  const toggleSaveButtonLoading = useCallback((id, state) => {
    setSaveButton((prev) => ({ ...prev, [id]: state }));
  }, []);

  const handleTextChange = useCallback((id, textValue, key) => {
    toggleSaveButtonState(id, false);
    setTextInput((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [id]: textValue || "" },
    }));
  }, [toggleSaveButtonState]);

  const handleSaveDescription = useCallback(
    async (productId, key) => {
      toggleSaveButtonLoading(productId, true);
      let textFieldValue = textInput[key]?.[productId] || "";
      const activeMetafieldData = associatedMetafields.find((m) => m.key === key);
      let result;
      if (textFieldValue === "") {
        const product = products.find((p) => p.id === productId);
        const metafield = product?.metafields?.find((m) => m.key === key);
        if (metafield) {
          const deleteResult = await deleteMetafield(metafield.id);
          if (deleteResult.success) {
            setProducts((prevProducts) =>
              prevProducts.map((p) =>
                p.id === productId
                  ? { ...p, metafields: p.metafields.filter((m) => m.id !== deleteResult.deletedId) }
                  : p
              )
            );
            result = true;
          } else {
            result = false;
          }
        } else {
          result = true;
        }
      } else {
        const updateResult = await updateProductMetafield(productId, textFieldValue, activeMetafieldData);
        if (updateResult.success) {
          setProducts((prevProducts) =>
            prevProducts.map((p) =>
              p.id === productId ? { ...p, metafields: updateResult.metafields } : p
            )
          );
          result = true;
        } else {
          result = false;
        }
      }
      toggleSaveButtonState(productId, result);
      toggleSaveButtonLoading(productId, false);
    },
    [associatedMetafields, products, textInput, toggleSaveButtonLoading, toggleSaveButtonState]
  );

  const handleSelectChange = useCallback(
    (value) => {
      setSelected(value);
      const selectedMetafield = associatedMetafields.find((m) => m.key === value);
      const isProd =
        selectedMetafield?.type?.name === "list.product_reference" ||
        selectedMetafield?.type?.name === "product_reference";
      setIsProductMetafield(isProd);
    },
    [associatedMetafields]
  );

  return (
    <Frame>
      <Page title="Configure Free Gifts">
        {associatedMetafields && (
          <>
            <Select label="Select Metafield" options={options} onChange={handleSelectChange} value={selected} />
            <TextField
              label="Search Products"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search by product title"
              clearButton
              onClearButtonClick={() => setSearchTerm("")}
            />
            <form onSubmit={handleSubmit}>
              <Card>
                {loading ? (
                  <Spinner accessibilityLabel="Loading products" size="large" />
                ) : (
                  <ResourceList
                    resourceName={{ singular: "product", plural: "products" }}
                    items={products}
                    renderItem={(item) => {
                      const { id, title } = item;
                      const groupData = selectedProductsByGroup[activeTabIndex] || {};
                      const currentEntries = groupData[selected] || [];
                      const entry = currentEntries.find((e) => e.productId === id);
                      const selectedItems = entry ? entry.selections : [];
                      const inputValue = textInput[selected]?.[id] || "";
                      return (
                        <ResourceItem id={id} accessibilityLabel={`View details for ${title}`}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {title}
                            </Text>
                            {options.find((option) => option.value === selected)?.type.name ===
                              "single_line_text_field" ||
                              options.find((option) => option.value === selected)?.type.name ===
                              "multi_line_text_field" ? (
                              <>
                                <TextField
                                  label={`Enter ${options.find((o) => o.value === selected)?.label}`}
                                  value={inputValue}
                                  onChange={(val) => handleTextChange(id, val, selected)}
                                  multiline={
                                    options.find((o) => o.value === selected)?.type.name === "multi_line_text_field"
                                      ? 5
                                      : undefined
                                  }
                                  autoComplete="off"
                                />
                                <ButtonGroup>
                                  <Button
                                    variant="primary"
                                    onClick={() => handleSaveDescription(id, selected)}
                                    disabled={disabledSaveButton[id]}
                                    loading={saveButton[id]}
                                  >
                                    Save
                                  </Button>
                                </ButtonGroup>
                              </>
                            ) : (
                              <Button onClick={() => openResourcePicker(id, options.find((o) => o.value === selected)?.type.name)}>
                                Select Product/Variant
                              </Button>
                            )}
                            {isProductMetafield && selectedItems.length > 0 && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  padding: "8px",
                                  border: "1px solid #d3d3d3",
                                  borderRadius: "4px",
                                  backgroundColor: "#f6f6f7",
                                  flexWrap: "wrap",
                                }}
                              >
                                {selectedItems.map((item) => (
                                  <div
                                    key={item.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      padding: "3px 6px",
                                      borderRadius: "3px",
                                      backgroundColor: "#e1e3e5",
                                      margin: "2px",
                                    }}
                                  >
                                    <Thumbnail source={item.image || ""} alt={item.title} size="small" />
                                    <Text as="span" variant="bodySm" style={{ marginLeft: "8px" }}>
                                      {item.isVariant ? `${item.productTitle} - ${item.title}` : item.title}
                                    </Text>
                                    <Button plain destructive onClick={() => removeProduct(id, item.id)}>
                                      ×
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </ResourceItem>
                      );
                    }}
                  />
                )}
              </Card>
            </form>
            {hasNextPage && !loading && (
              <Button onClick={() => loadProducts(nextCursor, true)} fullWidth>
                Load more products
              </Button>
            )}
          </>
        )}
      </Page>
      {hasChanges && (
        <div
          style={{
            position: "fixed",
            bottom: "0",
            width: "100%",
            backgroundColor: "#6fe8c0",
            padding: "10px",
            borderTop: "1px solid #d3d3d3",
          }}
        >
          <Button primary onClick={handleSubmit}>
            Save Changes
          </Button>
        </div>
      )}
    </Frame>
  );
}
