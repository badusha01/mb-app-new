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
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";

function fetchProducts(searchTerm = "", afterCursor = null) {
  return fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        query ($query: String, $after: String) {
          products(first: 5, query: $query, after: $after) {
            edges {
              cursor
              node {
                id
                title
                metafields(namespace: "custom", first: 1) {
                  edges {
                    node {
                      id
                      key
                      value
                    }
                  }
                }
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      image {
                        originalSrc
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
      variables: { query: searchTerm ? `title:*${searchTerm}*` : "", after: afterCursor },
    }),
  }).then((res) => res.json());
}

async function updateMetafield(productId, gifts) {
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

  const variantReferences = gifts.map((gift) => `${gift.id}`);
  const variables = {
    input: {
      id: productId,
      metafields: [
        {
          namespace: "custom",
          key: "giftvariants",
          value: JSON.stringify(variantReferences),
          type: "list.variant_reference",
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
      console.log("Metafield updated successfully:", result.data.productUpdate.product.metafields.edges);
    } else {
      console.error("Error updating metafield:", result.errors || result.data.productUpdate.userErrors);
    }
  } catch (error) {
    console.error("Request failed:", error);
  }
}

export default function SelectFreeGift() {

  const app = useAppBridge();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProductsByRow, setSelectedProductsByRow] = useState({});
  const [initialProductsByRow, setInitialProductsByRow] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);

  const loadProducts = async (afterCursor = null, append = false) => {
    setLoading(true);
    const data = await fetchProducts(searchTerm, afterCursor);
    const formattedProducts = data.data.products.edges.map((edge) => {
      const product = edge.node;

      const giftVariantsMetafield = product.metafields?.edges?.find(
        (metafield) => metafield.node.key === "giftvariants"
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
        variants: product.variants.edges.map((variant) => ({
          id: variant.node.id,
          title: variant.node.title,
          image: variant.node.image ? variant.node.image.originalSrc : null,
        })),
        prePopulatedVariants,
        cursor: edge.cursor,
      };
    });

    setProducts((prevProducts) => (append ? [...prevProducts, ...formattedProducts] : formattedProducts));

    const initialSelections = {};
    formattedProducts.forEach((product) => {
      initialSelections[product.id] = product.prePopulatedVariants;
    });

    setSelectedProductsByRow((prev) => (append ? { ...prev, ...initialSelections } : initialSelections));
    setInitialProductsByRow((prev) => (append ? { ...prev, ...initialSelections } : initialSelections));

    setHasNextPage(data.data.products.pageInfo.hasNextPage);
    setNextCursor(data.data.products.pageInfo.hasNextPage ? data.data.products.edges[data.data.products.edges.length - 1].cursor : null);
    setLoading(false);
  };

  useEffect(() => {
    loadProducts();
  }, [searchTerm]);

  const loadNextPage = () => {
    if (hasNextPage) loadProducts(nextCursor, true);
  };

  const handleSearchChange = (value) => {
    setSearchTerm(value);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    for (const productId in selectedProductsByRow) {
      const currentSelections = selectedProductsByRow[productId];
      const initialSelections = initialProductsByRow[productId] || [];

      if (JSON.stringify(currentSelections) !== JSON.stringify(initialSelections)) {
        const selectedGifts = currentSelections.map((item) => ({
          id: item.id,
          title: item.title,
        }));
        await updateMetafield(productId, selectedGifts);
      }
    }
    setHasChanges(false);
    console.log("Metafields updated for changed products.");
  };

  const openResourcePicker = async (productId) => {
    const pickerResult = await app.resourcePicker({
      type: "product",
      showVariants: true,
      multiple: true,
    });

    if (pickerResult && pickerResult.selection && pickerResult.selection.length > 0) {
      setSelectedProductsByRow((prev) => {
        const existingSelections = prev[productId] || [];

        const newSelections = pickerResult.selection.flatMap((item) => {
          if (item.variants && item.variants.length > 0) {
            return item.variants.map((variant) => ({
              id: variant.id,
              title: variant.title,
              image: variant.image ? variant.image.src : null,
              productTitle: item.title,
              isVariant: true,
            }));
          } else {
            return {
              id: item.id,
              title: item.title,
              image: item.images[0]?.src,
              isVariant: false,
            };
          }
        });

        const combinedSelections = [...existingSelections, ...newSelections];
        const uniqueSelections = Array.from(
          new Map(combinedSelections.map((item) => [item.id, item])).values()
        );

        setHasChanges(true);
        return {
          ...prev,
          [productId]: uniqueSelections,
        };
      });
    }
  };

  const removeProduct = (productId, selectedItemId) => {
    setSelectedProductsByRow((prev) => {
      const updatedSelections = prev[productId].filter((item) => item.id !== selectedItemId);
      setHasChanges(true);
      return {
        ...prev,
        [productId]: updatedSelections,
      };
    });
  };

  return (
    <Frame>
      <Page title="Configure Free Gifts">
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
                  const selectedItems = selectedProductsByRow[id] || [];

                  return (
                    <ResourceItem id={id} accessibilityLabel={`View details for ${title}`}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <Text as="span" variant="bodyMd" fontWeight="bold">{title}</Text>
                          <Button onClick={() => openResourcePicker(id)}>Select Product/Variant</Button>
                        </div>

                        {selectedItems.length > 0 && (
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
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '3px 6px',
                                  borderRadius: '3px',
                                  backgroundColor: '#e1e3e5',
                                  margin: '2px',
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
        {hasNextPage && !loading && (
          <Button onClick={loadNextPage} fullWidth>
            Load more products
          </Button>
        )}
      </Page>
      {hasChanges && (
        <div style={{ position: "fixed", bottom: "0", width: "100%", backgroundColor: "#6fe8c0", padding: "10px", borderTop: "1px solid #d3d3d3" }}>
          <Button primary onClick={handleSubmit}>Save Changes</Button>
        </div>
      )}
    </Frame>
  );
}
