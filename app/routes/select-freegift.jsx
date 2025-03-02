

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
import { useEffect, useState } from "react";

function fetchProducts(searchTerm = "", afterCursor = null) {
  return fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `
      query ($query: String, $after: String) {
        products(first: 5, query: $query, after: $after) {
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
      console.log("Fetched Products with Metafields:", data.data.products.edges);
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
  // For list types we send an array (JSON) of ids; for single reference we send the single id.
  const variantReferences = metafieldData.type.name.includes("list")
    ? gifts.map((gift) => `${gift.id}`)
    : gifts.length > 0
      ? gifts[0].id
      : ""; // if empty, clear it

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
      console.log(
        "Metafield updated successfully:",
        result.data.productUpdate.product.metafields.edges
      );
    } else {
      console.error(
        "Error updating metafield:",
        result.errors || result.data.productUpdate.userErrors
      );
    }
  } catch (error) {
    console.error("Request failed:", error);
  }
}

const updateProductMetafield = async (productId, value, activeMetafieldData) => {
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
      shopify.toast.show(`Error updating metafield: ${responseData.errors}`);
      console.log("Error updating metafield:", responseData.errors);
    } else if (responseData.data.productUpdate.userErrors.length > 0) {
      shopify.toast.show("User errors");
    } else {
      shopify.toast.show("Metafield updated successfully");
    }
    return true;
  } catch (error) {
    console.error("Request failed:", error);
    return false;
  }
};

export default function SelectFreeGift({
  groupId,
  activeTabIndex, // passed from the parent Groups component
  associatedMetafields,
}) {
  const app = useAppBridge();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);

  /*
    We store selections as an object keyed first by active group (activeTabIndex)
    then by the current metafield key. For example:
    {
      "0": {
         "product_reference": [ { productId, selections: [ ... ] } ],
         "list.product_reference": [ ... ]
      },
      "1": { ... }
    }
  */
  const [selectedProductsByGroup, setSelectedProductsByGroup] = useState({});
  const [initialProductsByGroup, setInitialProductsByGroup] = useState({});

  const [hasChanges, setHasChanges] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState(""); // current metafield key
  const [saveButton, setSaveButton] = useState({});
  const [disabledSaveButton, setDisabledSaveButton] = useState({});
  const [textInput, setTextInput] = useState({});
  const [isProductMetafield, setIsProductMetafield] = useState(false);

  // Load products and build an object mapping each metafield key → entries.
  const loadProducts = async (afterCursor = null, append = false) => {
    setLoading(true);
    const data = await fetchProducts(searchTerm, afterCursor);
    const formattedProducts = data.data.products.edges.map((edge) => {
      const product = edge.node;
      const giftVariantsMetafield = product.metafields?.edges?.find(
        (metafield) => metafield.node.key === "recommendations"
      );
      const prePopulatedVariants = giftVariantsMetafield
        ? JSON.parse(giftVariantsMetafield.node.value).map((variantId) => ({
          id: variantId,
          title: "Gift Variant",
          productTitle: product.title,
          isVariant: true,
        }))
        : [];
      return {
        id: product.id,
        title: product.title,
        variants: product.variants?.edges?.map((variant) => ({
          id: variant.node.id,
          title: variant.node.title,
          image: variant.node.image ? variant.node.image.originalSrc : null,
        })),
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

    // Build text input values.
    const newTextInputValues = {};
    formattedProducts.forEach((product) => {
      product.metafields.forEach((metafield) => {
        if (!newTextInputValues[metafield.key]) {
          newTextInputValues[metafield.key] = {};
        }
        newTextInputValues[metafield.key][product.id] = metafield.value || "";
      });
    });

    // Build an object mapping each metafield key to its array of entries.
    const newSelectedProductsObj = {};
    // When processing each product in loadProducts:
    formattedProducts.forEach((product) => {
      product.metafields.forEach((metafield) => {
        let selections = [];
        // For list metafields stored as JSON strings, parse the value.
        if (
          associatedMetafields.find((m) => m.key === metafield.key)?.type.name.includes("list") &&
          metafield.value
        ) {
          try {
            const parsedIds = JSON.parse(metafield.value);
            selections = parsedIds.map((id) => ({
              id,
              // You might need to fetch additional details like title and images if necessary.
              title: "Saved Product",
              images: [],
            }));
          } catch (e) {
            console.error("Failed to parse metafield value", e);
          }
        }
        // For non-list metafields, use referenceProducts from the query.
        else if (metafield.referenceProducts && metafield.referenceProducts.length > 0) {
          selections = metafield.referenceProducts.map((refProd) => ({
            id: refProd.id,
            title: refProd.title,
            images: refProd.images,
          }));
        }

        if (selections.length > 0) {
          if (!newSelectedProductsObj[metafield.key]) {
            newSelectedProductsObj[metafield.key] = [];
          }
          newSelectedProductsObj[metafield.key].push({
            productId: product.id,
            selections,
          });
        }
      });
    });


    console.log("formattedProducts", formattedProducts);
    console.log("newSelectedProductsObj", newSelectedProductsObj);

    setProducts(append ? [...products, ...formattedProducts] : formattedProducts);
    setTextInput(append ? { ...textInput, ...newTextInputValues } : newTextInputValues);
    setSelectedProductsByGroup((prev) => ({
      ...prev,
      [activeTabIndex]:
        append && prev[activeTabIndex]
          ? { ...prev[activeTabIndex], ...newSelectedProductsObj }
          : newSelectedProductsObj,
    }));
    setInitialProductsByGroup((prev) => ({
      ...prev,
      [activeTabIndex]:
        append && prev[activeTabIndex]
          ? { ...prev[activeTabIndex], ...newSelectedProductsObj }
          : newSelectedProductsObj,
    }));
    setHasNextPage(data.data.products.pageInfo.hasNextPage);
    setNextCursor(
      data.data.products.pageInfo.hasNextPage
        ? data.data.products.edges[data.data.products.edges.length - 1].cursor
        : null
    );
    setLoading(false);
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, activeTabIndex]);

  useEffect(() => {
    console.log("Updated selectedProductsByGroup:", selectedProductsByGroup);
  }, [selectedProductsByGroup, activeTabIndex]);

  useEffect(() => {
    if (associatedMetafields && associatedMetafields.length > 0) {
      setSelected(associatedMetafields[0].key);
      const sel = associatedMetafields[0];
      const isProd =
        sel?.type?.name === "list.product_reference" ||
        sel?.type?.name === "product_reference";
      setIsProductMetafield(isProd);
    }
  }, [associatedMetafields]);

  const loadNextPage = () => {
    if (hasNextPage) loadProducts(nextCursor, true);
  };

  const handleSearchChange = (value) => {
    setSearchTerm(value);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const activeMetafieldData = associatedMetafields.find(
      (metafield) => metafield.key === selected
    );
    const groupData = selectedProductsByGroup[activeTabIndex] || {};
    const groupSelected = groupData[selected] || [];
    const groupInitial = (initialProductsByGroup[activeTabIndex] || {})[selected] || [];
    for (const entry of groupSelected) {
      const productId = entry.productId;
      const initialEntry = groupInitial.find((item) => item.productId === productId);
      const currentSelections = entry.selections;
      const initialSelections = initialEntry ? initialEntry.selections : [];
      if (JSON.stringify(currentSelections) !== JSON.stringify(initialSelections)) {
        const selectedGifts = currentSelections.map((item) => ({
          id: item.id,
          title: item.title,
        }));
        await updateMetafield(productId, selectedGifts, activeMetafieldData);
      }
    }
    setHasChanges(false);
    console.log("Metafields updated for changed products.");
  };

  // Open the resource picker with initial selections.
  // const openResourcePicker = async (productId, metafieldType) => {
  //   const multiple = metafieldType.includes("list");
  //   const group = selectedProductsByGroup[activeTabIndex] || {};
  //   const currentEntries = group[selected] || [];
  //   const entry = currentEntries.find((e) => e.productId === productId);
  //   const initialSelectionIds = entry ? entry.selections.map((item) => item.id) : [];
  //   const pickerResult = await app.resourcePicker({
  //     type: "product",
  //     showVariants: false,
  //     multiple,
  //     initialSelectionIds,
  //   });
  //   console.log("PickerResult:", pickerResult);
  //   if (pickerResult && pickerResult.selection && pickerResult.selection.length > 0) {
  //     setSelectedProductsByGroup((prev) => {
  //       const group = prev[activeTabIndex] || {};
  //       const currentEntries = group[selected] || [];
  //       const idx = currentEntries.findIndex((entry) => entry.productId === productId);
  //       let newEntry;
  //       if (!metafieldType.includes("list")) {
  //         // For single product reference, override any existing selection.
  //         newEntry = {
  //           productId,
  //           selections: [
  //             {
  //               id: pickerResult.selection[0].id,
  //               title: pickerResult.selection[0].title,
  //               image: pickerResult.selection[0].images[0]?.src,
  //               isVariant: false,
  //             },
  //           ],
  //         };
  //       } else {
  //         // For list type, merge new selections.
  //         let existingSelections = idx !== -1 ? currentEntries[idx].selections : [];
  //         const newSelections = pickerResult.selection.map((item) => ({
  //           id: item.id,
  //           title: item.title,
  //           image: item.images[0]?.src,
  //           isVariant: false,
  //         }));
  //         const combinedSelections = [...existingSelections, ...newSelections];
  //         const uniqueSelections = Array.from(new Map(combinedSelections.map((item) => [item.id, item])).values());
  //         newEntry = { productId, selections: uniqueSelections };
  //       }
  //       let newEntries = idx !== -1
  //         ? currentEntries.map((entry) => (entry.productId === productId ? newEntry : entry))
  //         : [...currentEntries, newEntry];
  //       setHasChanges(true);
  //       return {
  //         ...prev,
  //         [activeTabIndex]: {
  //           ...group,
  //           [selected]: newEntries,
  //         },
  //       };
  //     });
  //   }
  // };

  const openResourcePicker = async (productId, metafieldType) => {
    const multiple = metafieldType.includes("list");
    const group = selectedProductsByGroup[activeTabIndex] || {};
    const currentEntries = group[selected] || [];
    const entry = currentEntries.find((e) => e.productId === productId);
    const entryIDs = entry ? entry.selections.map((item) => ({ id: item.id })) : []

    console.log("Entry:", entry);
    console.log("ENIDS:", entryIDs)
    const pickerResult = await app.resourcePicker({
      type: "product",
      filter: {
        variants: false,
      },
      multiple,
      selectionIds: entryIDs
    });
    // console.log("Picker Result Selection IDs:", pickerResult.selection.map(item => item.id));
    console.log("PickerResult:", pickerResult);
    if (pickerResult && pickerResult.selection && pickerResult.selection.length > 0) {
      setSelectedProductsByGroup((prev) => {
        const group = prev[activeTabIndex] || {};
        const currentEntries = group[selected] || [];
        const idx = currentEntries.findIndex((entry) => entry.productId === productId);
        let newEntry;
        if (!metafieldType.includes("list")) {
          // For single product reference, override any existing selection.
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
          // For list type, merge new selections.
          let existingSelections = idx !== -1 ? currentEntries[idx].selections : [];
          const newSelections = pickerResult.selection.map((item) => ({
            id: item.id,
            title: item.title,
            image: item.images[0]?.src,
            isVariant: false,
          }));
          const combinedSelections = [...existingSelections, ...newSelections];
          const uniqueSelections = Array.from(new Map(combinedSelections.map((item) => [item.id, item])).values());
          newEntry = { productId, selections: uniqueSelections };
        }
        let newEntries = idx !== -1
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
  };

  // Remove product from a single product metafield immediately by updating Shopify as well.
  const removeProduct = (productId, selectedItemId) => {
    setSelectedProductsByGroup((prev) => {
      const group = prev[activeTabIndex] || {};
      const currentEntries = group[selected] || [];
      const selectedMetafield = associatedMetafields.find((m) => m.key === selected);
      const idx = currentEntries.findIndex((entry) => entry.productId === productId);
      if (idx !== -1) {
        let newEntries;
        if (!selectedMetafield?.type?.name.includes("list")) {
          // For single product reference, removal means deleting the entire entry.
          newEntries = currentEntries.filter((entry) => entry.productId !== productId);
          // Immediately update Shopify to clear the metafield.
          updateMetafield(productId, [], selectedMetafield);
        } else {
          const updatedSelections = currentEntries[idx].selections.filter(
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
  };

  const toggleSaveButtonState = (id, state) => {
    setDisabledSaveButton((prev) => ({
      ...prev,
      [id]: state,
    }));
  };

  const toggleSaveButtonLoading = (id, state) => {
    setSaveButton((prev) => ({
      ...prev,
      [id]: state,
    }));
  };

  const handleTextChange = (id, textValue, key) => {
    toggleSaveButtonState(id, false);
    setTextInput((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [id]: textValue || "",
      },
    }));
  };

  const handleSaveDescription = async (productId, key) => {
    toggleSaveButtonLoading(productId, true);
    let textFieldValue = textInput[key][productId];
    if (textFieldValue === "") {
      textFieldValue = "";
    }
    const activeMetafieldData = associatedMetafields.find((metafield) => metafield.key === key);
    const result = await updateProductMetafield(productId, textFieldValue, activeMetafieldData);
    toggleSaveButtonState(productId, result);
    toggleSaveButtonLoading(productId, !result);
  };

  const handleSelectChange = (value) => {
    setSelected(value);
    const selectedMetafield = associatedMetafields.find((metafield) => metafield.key === value);
    const isProd =
      selectedMetafield?.type?.name === "list.product_reference" ||
      selectedMetafield?.type?.name === "product_reference";
    setIsProductMetafield(isProd);
  };

  const options = associatedMetafields?.map((group) => ({
    label: group.name,
    value: group.key,
    type: group.type,
  }));

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
                      console.log("rendering item", item);
                      const { id, title } = item;
                      const groupData = selectedProductsByGroup[activeTabIndex] || {};
                      const currentEntries = groupData[selected] || [];
                      const entry = currentEntries.find((e) => e.productId === id);
                      const selectedItems = entry ? entry.selections : [];
                      const metafieldKey = selected;
                      const selectedMetafield = options.find((option) => option.value === selected);
                      console.log("Selected Items:", selectedItems);
                      const inputValue = textInput[metafieldKey]?.[id] || "";
                      return (
                        <ResourceItem id={id} accessibilityLabel={`View details for ${title}`}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {title}
                            </Text>
                            {selectedMetafield?.type?.name === "single_line_text_field" ||
                              selectedMetafield?.type?.name === "multi_line_text_field" ? (
                              <>
                                <TextField
                                  label={`Enter ${selectedMetafield.label}`}
                                  value={inputValue}
                                  onChange={(val) => handleTextChange(id, val, metafieldKey)}
                                  multiline={
                                    selectedMetafield?.type?.name === "multi_line_text_field" ? 5 : undefined
                                  }
                                  autoComplete="off"
                                />
                                <ButtonGroup>
                                  <Button
                                    variant="primary"
                                    onClick={() => handleSaveDescription(id, metafieldKey)}
                                    disabled={disabledSaveButton[id]}
                                    loading={saveButton[id]}
                                  >
                                    Save
                                  </Button>
                                </ButtonGroup>
                              </>
                            ) : (
                              <Button onClick={() => openResourcePicker(id, selectedMetafield?.type?.name)}>
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
                                    <Button
                                      plain
                                      destructive
                                      onClick={() => removeProduct(id, item.id)}
                                      style={{ marginLeft: "8px" }}
                                    >
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
            {hasNextPage && !loading && <Button onClick={loadNextPage} fullWidth>Load more products</Button>}
          </>
        )}
      </Page>
      <div style={{ marginTop: "15px" }}></div>
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











// import {
//   Page,
//   Card,
//   ResourceList,
//   ResourceItem,
//   Text,
//   Button,
//   Spinner,
//   Thumbnail,
//   Frame,
//   TextField,
//   Select,
//   ButtonGroup,
// } from "@shopify/polaris";
// import { useAppBridge } from "@shopify/app-bridge-react";
// import { act, useEffect, useState } from "react";
// import { isVariableDeclaration } from "typescript";

// function fetchProducts(searchTerm = "", afterCursor = null) {
//   return fetch("shopify:admin/api/graphql.json", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       query: `
//         query ($query: String, $after: String) {
//   products(first: 5, query: $query, after: $after) {
//     edges {
//       cursor
//       node {
//         id
//         title
//         metafields(first: 10) {
//           edges {
//             node {
//               id
//               key
//               value
//               type
//               reference {
//                 ... on Product {
//                   title
//                   images(first: 10) {
//                     edges {
//                       node {
//                         url
//                       }
//                     }
//                   }
//                 }
//               }
//               references(first: 10) {
//                 edges {
//                   node {
//                     ... on Product {
//                       title
//                       images(first: 10) {
//                         edges {
//                           node {
//                             url
//                           }
//                         }
//                       }
//                     }
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }
//     }
//     pageInfo {
//       hasNextPage
//     }
//   }
// }
//       `,
//       variables: {
//         query: searchTerm ? `title:*${searchTerm}*` : "",
//         after: afterCursor,
//       },
//     }),
//   })
//     .then((res) => res.json())
//     .then((data) => {
//       console.log(
//         "Fetched Products with Metafields:",
//         data.data.products.edges,
//       );
//       return data;
//     });
// }

// async function updateMetafield(productId, gifts, metafieldData) {
//   const mutation = `
//     mutation updateProductMetafield($input: ProductInput!) {
//       productUpdate(input: $input) {
//         product {
//           id
//           metafields(first: 10) {
//             edges {
//               node {
//                 id
//                 namespace
//                 key
//                 value
//               }
//             }
//           }
//         }
//         userErrors {
//           field
//           message
//         }
//       }
//     }
//   `;

//   const variantReferences = metafieldData.type.name.includes("list")
//     ? gifts.map((gift) => `${gift.id}`)
//     : gifts[0].id;

//   const variables = {
//     input: {
//       id: productId,
//       metafields: [
//         {
//           namespace: metafieldData.namespace,
//           key: metafieldData.key,
//           value: metafieldData.type.name.includes("list")
//             ? JSON.stringify(variantReferences)
//             : variantReferences,
//           type: metafieldData.type.name,
//         },
//       ],
//     },
//   };

//   try {
//     const response = await fetch("shopify:admin/api/graphql.json", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ query: mutation, variables }),
//     });
//     const result = await response.json();
//     if (result.data && result.data.productUpdate) {
//       console.log(
//         "Metafield updated successfully:",
//         result.data.productUpdate.product.metafields.edges,
//       );
//     } else {
//       console.error(
//         "Error updating metafield:",
//         result.errors || result.data.productUpdate.userErrors,
//       );
//     }
//   } catch (error) {
//     console.error("Request failed:", error);
//   }
// }


// const updateProductMetafield = async (productId, value, activeMetafieldData) => {
//   const query = `
//     mutation updateProductMetafield($input: ProductInput!) {
//       productUpdate(input: $input) {
//         product {
//           id
//           metafields(first: 10) {
//             edges {
//               node {
//                 id
//                 namespace
//                 key
//                 value
//                 type
//               }
//             }
//           }
//         }
//         userErrors {
//           field
//           message
//         }
//       }
//     }
//   `;

//   // Ensure empty values are sent as empty strings
//   const metafieldValue = value === null || value === "" ? "" : value;

//   const variables = {
//     input: {
//       id: productId,
//       metafields: [
//         {
//           namespace: activeMetafieldData.namespace,
//           key: activeMetafieldData.key,
//           value: metafieldValue,
//           type: activeMetafieldData.type.name,
//         },
//       ],
//     },
//   };

//   try {
//     const response = await fetch("shopify:admin/api/graphql.json", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ query, variables }),
//     });

//     const responseData = await response.json();

//     if (responseData.errors) {
//       shopify.toast.show(`Error updating metafield: ${responseData.errors}`);
//       console.log("Error updating metafield:", responseData.errors);
//     } else if (responseData.data.productUpdate.userErrors.length > 0) {
//       shopify.toast.show("User errors");
//     } else {
//       shopify.toast.show("Metafield updated successfully");
//     }

//     return true;
//   } catch (error) {
//     console.error("Request failed:", error);
//     return false;
//   }
// };


// export default function SelectFreeGift({
//   groupId,
//   activeTabIndex,
//   associatedMetafields,
// }) {
//   const app = useAppBridge();
//   const [products, setProducts] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const [selectedProductsByRow, setSelectedProductsByRow] = useState([]);
//   const [initialProductsByRow, setInitialProductsByRow] = useState([]);
//   const [hasChanges, setHasChanges] = useState(false);
//   const [searchTerm, setSearchTerm] = useState("");
//   const [nextCursor, setNextCursor] = useState(null);
//   const [hasNextPage, setHasNextPage] = useState(false);
//   const [selected, setSelected] = useState("");
//   const [saveButton, setSaveButton] = useState({});
//   const [disabledSaveButton, setDisabledSaveButton] = useState({});
//   const [textInput, setTextInput] = useState({});
//   const [isProductMetafield, setIsProductMetafield] = useState(false);



//   const loadProducts = async (afterCursor = null, append = false) => {              // solved issue of products data from admin not shown in app
//     setLoading(true);
//     const data = await fetchProducts(searchTerm, afterCursor);

//     const formattedProducts = data.data.products.edges.map((edge) => {
//       const product = edge.node;

//       // Extracting gift variants from metafields
//       const giftVariantsMetafield = product.metafields?.edges?.find(
//         (metafield) => metafield.node.key === "recommendations",
//       );

//       const prePopulatedVariants = giftVariantsMetafield
//         ? JSON.parse(giftVariantsMetafield.node.value).map((variantId) => ({
//           id: variantId,
//           title: "Gift Variant",
//           productTitle: product.title,
//           isVariant: true,
//         }))
//         : [];

//       return {
//         id: product.id,
//         title: product.title,
//         variants: product.variants?.edges.map((variant) => ({
//           id: variant.node.id,
//           title: variant.node.title,
//           image: variant.node.image ? variant.node.image.originalSrc : null,
//         })),
//         prePopulatedVariants,
//         metafields: product.metafields?.edges?.map((m) => {
//           const metafield = m.node;
//           let referenceProducts = [];

//           if (metafield.reference) {
//             referenceProducts.push({
//               title: metafield.reference.title,
//               images: metafield.reference.images.edges.map((img) => img.node.url),
//             });
//           }

//           if (metafield.references) {
//             referenceProducts = metafield.references.edges.map((refEdge) => ({
//               title: refEdge.node.title,
//               images: refEdge.node.images.edges.map((img) => img.node.url),
//             }));
//           }

//           return {
//             id: metafield.id,
//             key: metafield.key,
//             value: metafield.value,
//             type: metafield.type,
//             referenceProducts,
//           };
//         }) || [], // Ensure metafields is always an array
//         cursor: edge.cursor,
//       };
//     });

//     const newTextInputValues = {};
//     const newSelectedProductsByRow = [];

//     formattedProducts.forEach((product) => {
//       product.metafields.forEach((metafield) => {
//         if (!newTextInputValues[metafield.key]) {
//           newTextInputValues[metafield.key] = {};
//         }
//         newTextInputValues[metafield.key][product.id] = metafield.value || "";

//         if (metafield.referenceProducts.length > 0) {
//           newSelectedProductsByRow[product.id] = metafield.referenceProducts.map((refProd) => ({
//             title: refProd.title,
//             images: refProd.images,
//           }));
//         }
//       });
//     });

//     console.log("formattedProducts", formattedProducts);
//     console.log("selectedProductsByRow", newSelectedProductsByRow);

//     setProducts((prevProducts) =>
//       append ? [...prevProducts, ...formattedProducts] : formattedProducts,
//     );

//     setTextInput((prev) =>
//       append ? { ...prev, ...newTextInputValues } : newTextInputValues,
//     );

//     setSelectedProductsByRow((prev) =>
//       append ? { ...prev, ...newSelectedProductsByRow } : newSelectedProductsByRow,
//     );
//     setInitialProductsByRow((prev) =>
//       append ? { ...prev, ...newSelectedProductsByRow } : newSelectedProductsByRow,
//     );

//     setHasNextPage(data.data.products.pageInfo.hasNextPage);
//     setNextCursor(
//       data.data.products.pageInfo.hasNextPage
//         ? data.data.products.edges[data.data.products.edges.length - 1].cursor
//         : null,
//     );
//     setLoading(false);
//   };


//   useEffect(() => {
//     loadProducts();
//   }, [searchTerm]);

//   useEffect(() => {
//     console.log("Updated selectedProductsByRow:", selectedProductsByRow);
//   }, [selectedProductsByRow]);

//   useEffect(() => {
//     if (associatedMetafields && associatedMetafields.length > 0) {
//       setSelected(associatedMetafields[0].key);
//     }
//   }, [associatedMetafields]);

//   const loadNextPage = () => {
//     if (hasNextPage) loadProducts(nextCursor, true);
//   };

//   const handleSearchChange = (value) => {
//     setSearchTerm(value);
//   };

//   const handleSubmit = async (event) => {
//     event.preventDefault();
//     const activeMetafieldData = associatedMetafields.find(
//       (metafield) => metafield.key == selected,
//     );
//     for (const productId in selectedProductsByRow) {
//       const currentSelections = selectedProductsByRow[productId];
//       const initialSelections = initialProductsByRow[productId] || [];

//       if (
//         JSON.stringify(currentSelections) !== JSON.stringify(initialSelections)
//       ) {
//         const selectedGifts = currentSelections.map((item) => ({
//           id: item.id,
//           title: item.title,
//         }));
//         await updateMetafield(productId, selectedGifts, activeMetafieldData);
//       }
//     }
//     setHasChanges(false);
//     console.log("Metafields updated for changed products.");
//   };

//   const openResourcePicker = async (productId, metafieldType) => {
//     const pickerResult = await app.resourcePicker({
//       type: "product",
//       showVariants: false,
//       multiple:
//         metafieldType === "list.product_reference" ||
//           metafieldType === "product_reference"
//           ? metafieldType === "list.product_reference"
//           : false,
//     });
//     console.log("PickerResult:", pickerResult);

//     if (
//       pickerResult &&
//       pickerResult.selection &&
//       pickerResult.selection.length > 0
//     ) {
//       setSelectedProductsByRow((prev) => {
//         const existingSelections = prev[productId] || [];

//         const newSelections = pickerResult.selection.flatMap((item) => {
//           return {
//             id: item.id,
//             title: item.title,
//             image: item.images[0]?.src,
//             isVariant: false,
//           };
//         });

//         const combinedSelections = [...existingSelections, ...newSelections];
//         const uniqueSelections = Array.from(
//           new Map(combinedSelections.map((item) => [item.id, item])).values(),
//         );
//         setHasChanges(true);
//         // console.log("Unique Selections:", uniqueSelections);
//         console.log("Updated selectedProductsByRow:", { ...prev, [productId]: uniqueSelections });
//         return {
//           ...prev,
//           [productId]: uniqueSelections,
//         };
//       });
//     }
//   };


//   const removeProduct = (productId, selectedItemId) => {
//     setSelectedProductsByRow((prev) => {
//       const updatedSelections = prev[productId].filter(
//         (item) => item.id !== selectedItemId,
//       );
//       setHasChanges(true);
//       return {
//         ...prev,
//         [productId]: updatedSelections,
//       };
//     });
//   };

//   const toggleSaveButtonState = (id, state) => {
//     setDisabledSaveButton((prev) => ({
//       ...prev,
//       [id]: state,
//     }));
//   };

//   const toggleSaveButtonLoading = (id, state) => {
//     setSaveButton((prev) => ({
//       ...prev,
//       [id]: state,
//     }));
//   };

//   const handleTextChange = (id, textValue, key) => {
//     toggleSaveButtonState(id, false);
//     setTextInput((prev) => ({
//       ...prev,
//       [key]: {
//         ...(prev[key] || {}),
//         [id]: textValue || "",
//       },
//     }));
//   };

//   const handleSaveDescription = async (productId, key) => {
//     toggleSaveButtonLoading(productId, true);
//     let textFieldValue = textInput[key][productId];
//     if (textFieldValue === "") {
//       textFieldValue = "";
//     }
//     const activeMetafieldData = associatedMetafields.find(
//       (metafield) => metafield.key === key,
//     );
//     const result = await updateProductMetafield(
//       productId,
//       textFieldValue,
//       activeMetafieldData,
//     );
//     toggleSaveButtonState(productId, result);
//     toggleSaveButtonLoading(productId, !result);
//   };


//   const handleSelectChange = (value) => {
//     setSelected(value);

//     const selectedMetafield = associatedMetafields.find(
//       (metafield) => metafield.key === value,
//     );


//     const isProductType =
//       selectedMetafield?.type?.name === "list.product_reference" ||       // Check if the new metafield is a product reference
//       selectedMetafield?.type?.name === "product_reference";

//     setIsProductMetafield(isProductType);                            // Toggle visibility instead of clearing data
//   };

//   // const handleSelectChange = (value) => {
//   //   setSelected(value);

//   //   const selectedMetafield = associatedMetafields.find(
//   //     (metafield) => metafield.key === value,
//   //   );

//   //   const isProductType =
//   //     selectedMetafield?.type?.name === "list.product_reference" ||
//   //     selectedMetafield?.type?.name === "product_reference";

//   //   setIsProductMetafield(isProductType);

//   //   if (isProductType) {
//   //     // Filter products to include only those with the selected metafield
//   //     const filteredProducts = products.map((product) => {
//   //       const metafield = product.metafields.find(
//   //         (m) => m.key === selectedMetafield.key,
//   //       );

//   //       if (metafield) {
//   //         return {
//   //           ...product,
//   //           metafields: [metafield], // Only include the selected metafield
//   //         };
//   //       } else {
//   //         // return null; // Exclude products without the selected metafield
//   //       }
//   //     }).filter(Boolean); // Remove null values

//   //     setProducts(filteredProducts);
//   //   } else {
//   //     // Reset to all products if the selected metafield is not a product reference type
//   //     loadProducts();
//   //   }

//   //   // Reset selectedProductsByRow when switching metafield types
//   //   setSelectedProductsByRow({});
//   // };

//   const options = associatedMetafields?.map((group) => ({
//     label: group.name,
//     value: group.key,
//     type: group.type,
//   }));

//   return (
//     <Frame>
//       <Page title="Configure Free Gifts">
//         {associatedMetafields && (
//           <>
//             <Select
//               label="Select Metafield"
//               options={options}
//               onChange={handleSelectChange}
//               value={selected}
//             />
//             <TextField
//               label="Search Products"
//               value={searchTerm}
//               onChange={handleSearchChange}
//               placeholder="Search by product title"
//               clearButton
//               onClearButtonClick={() => setSearchTerm("")}
//             />

//             <form onSubmit={handleSubmit}>
//               <Card>
//                 {loading ? (
//                   <Spinner accessibilityLabel="Loading products" size="large" />
//                 ) : (
//                   <ResourceList
//                     resourceName={{ singular: "product", plural: "products" }}
//                     items={products}
//                     renderItem={(item) => {
//                       console.log("rendering item", item);
//                       const { id, title } = item;
//                       const selectedItems = selectedProductsByRow[id] || [];
//                       const metafieldKey = selected;
//                       const selectedMetafield = options.find(
//                         (option) => option.value === selected,
//                       );
//                       // console.log("SelectedMetafield:", selectedMetafield);
//                       console.log("Selected Items:", selectedItems);
//                       const inputValue = textInput[metafieldKey]?.[id] || "";
//                       // console.log(title, ":", inputValue);

//                       return (
//                         <ResourceItem
//                           id={id}
//                           accessibilityLabel={`View details for ${title}`}
//                         >
//                           <div
//                             style={{
//                               display: "flex",
//                               flexDirection: "column",
//                               gap: "15px",
//                             }}
//                           >
//                             {/* <div
//                               style={{
//                                 display: "flex",
//                                 justifyContent: "space-between",
//                                 alignItems: "center",
//                               }}
//                             > */}
//                             <Text as="span" variant="bodyMd" fontWeight="bold">
//                               {title}
//                             </Text>
//                             {selectedMetafield?.type?.name ==
//                               "single_line_text_field" ||
//                               selectedMetafield?.type?.name ==
//                               "multi_line_text_field" ? (
//                               <>
//                                 <TextField
//                                   label={`Enter ${selectedMetafield.label}`}
//                                   value={inputValue}
//                                   onChange={(val) =>
//                                     handleTextChange(id, val, metafieldKey)
//                                   }
//                                   multiline={
//                                     selectedMetafield?.type?.name ===
//                                       "multi_line_text_field"
//                                       ? 5
//                                       : undefined
//                                   }
//                                   autoComplete="off"
//                                 />
//                                 <ButtonGroup>
//                                   {/* <Button onClick={() => handleCancel(id)}>Cancel</Button> */}
//                                   <Button
//                                     variant="primary"
//                                     onClick={() =>
//                                       handleSaveDescription(id, metafieldKey)
//                                     }
//                                     disabled={disabledSaveButton[id]}
//                                     loading={saveButton[id]}
//                                   >
//                                     Save
//                                   </Button>
//                                 </ButtonGroup>
//                               </>
//                             ) : (
//                               <Button
//                                 onClick={() =>
//                                   openResourcePicker(
//                                     id,
//                                     selectedMetafield?.type?.name,
//                                   )
//                                 }
//                               >
//                                 Select Product/Variant
//                               </Button>
//                             )}
//                             {/* </div> */}
//                             {isProductMetafield && selectedItems.length > 0 && (
//                               <div
//                                 style={{
//                                   display: "flex",
//                                   alignItems: "center",
//                                   gap: "8px",
//                                   padding: "8px",
//                                   border: "1px solid #d3d3d3",
//                                   borderRadius: "4px",
//                                   backgroundColor: "#f6f6f7",
//                                   flexWrap: "wrap",
//                                 }}
//                               >
//                                 {console.log("Selected Items", selectedItems)}
//                                 {selectedItems.map((item) => (
//                                   <div
//                                     key={item.id}
//                                     style={{
//                                       display: "flex",
//                                       alignItems: "center",
//                                       padding: "3px 6px",
//                                       borderRadius: "3px",
//                                       backgroundColor: "#e1e3e5",
//                                       margin: "2px",
//                                     }}
//                                   >
//                                     <Thumbnail
//                                       source={item.image || ""}
//                                       alt={item.title}
//                                       size="small"
//                                     />
//                                     <Text
//                                       as="span"
//                                       variant="bodySm"
//                                       style={{ marginLeft: "8px" }}
//                                     >
//                                       {item.isVariant
//                                         ? `${item.productTitle} - ${item.title}`
//                                         : item.title}
//                                     </Text>
//                                     <Button
//                                       plain
//                                       destructive
//                                       onClick={() => removeProduct(id, item.id)}
//                                       style={{ marginLeft: "8px" }}
//                                     >
//                                       ×
//                                     </Button>
//                                   </div>
//                                 ))}
//                               </div>
//                             )}
//                           </div>
//                         </ResourceItem>
//                       );
//                     }}
//                   />
//                 )}
//               </Card>
//             </form>
//             {hasNextPage && !loading && (
//               <Button onClick={loadNextPage} fullWidth>
//                 Load more products
//               </Button>
//             )}
//           </>
//         )}
//       </Page>

//       <div
//         style={{
//           marginTop: "15px",
//         }}
//       ></div>

//       {hasChanges && (
//         <div
//           style={{
//             position: "fixed",
//             bottom: "0",
//             width: "100%",
//             backgroundColor: "#6fe8c0",
//             padding: "10px",
//             borderTop: "1px solid #d3d3d3",
//           }}
//         >
//           <Button primary onClick={handleSubmit}>
//             Save Changes
//           </Button>
//         </div>
//       )}
//     </Frame>
//   );
// }

// /*
// TODO

// Add the group name in the Assign meta fields modal (for which group we are assigning metafield) - done
// Fix UI issue when adding a new group (group is created twice in the UI - issue with array) -done
// Implement two way data sharing for product recommendation
// Show 'No Metafields Selected' when metafields are not assigned
// */

// /*
//  Check the product fetching api for details more than Id of products
//  Check Thumbnail for UI of selected products
//  initialize setSelectedProductsByRow as an array of object (like each for each tab. Just like the working of activeTabIndex in groups.
//  Also use activeTabIndex with setSelectedProductsByRow)
//  Make changes inside openResourcePicker() and
//  */






